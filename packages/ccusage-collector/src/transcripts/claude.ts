// Claude Code transcript parsing, ported from T3 Code
// (https://github.com/pingdotgg/t3code, apps/server/src/provider/Drivers/claudeUsage.ts).
/*
MIT License

Copyright (c) 2026 T3 Tools Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import { readFileSync, realpathSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import {
  isRecord,
  parseTimestampMs,
  tokenCount,
  type UsageRequest,
} from "./types.js";

// Claude Code uses this model for local placeholders that never reached the API.
const SYNTHETIC_MODEL = "<synthetic>";

// Claude Code deletes transcripts this many days after their last write
// unless settings.json sets cleanupPeriodDays.
const DEFAULT_RETENTION_DAYS = 30;

function cacheCreation1h(usage: Record<string, unknown>): number {
  const split = usage.cache_creation;
  return isRecord(split) ? tokenCount(split.ephemeral_1h_input_tokens) : 0;
}

/**
 * Claude Code writes one line per assistant content block, and each repeats
 * the complete `usage` of its message. Summing them overcounts, so requests
 * carry `messageId:requestId` as dedupeKey and the caller keeps the first.
 */
export function parseClaudeLine(line: string): UsageRequest[] {
  // Most lines carry no usage; skip parsing them
  if (!line.includes('"usage"')) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || parsed.type !== "assistant") return [];
  const message = parsed.message;
  if (!isRecord(message) || !isRecord(message.usage)) return [];
  const usage = message.usage;

  const timestampMs = parseTimestampMs(parsed.timestamp);
  if (timestampMs === null) return [];
  const model = typeof message.model === "string" ? message.model : "";
  if (model.length === 0 || model === SYNTHETIC_MODEL) return [];

  const messageId = typeof message.id === "string" ? message.id : null;
  const requestId =
    typeof parsed.requestId === "string" ? parsed.requestId : null;
  const dedupeKey =
    messageId === null && requestId === null
      ? null
      : `${messageId ?? ""}:${requestId ?? ""}`;
  const cost = parsed.costUSD;
  const details = usage.output_tokens_details;
  const sessionId =
    typeof parsed.sessionId === "string" ? parsed.sessionId : "";
  const speed = usage.speed === "fast" ? "fast" : "standard";
  const inferenceGeo =
    typeof usage.inference_geo === "string" ? usage.inference_geo : undefined;

  const executor: UsageRequest = {
    timestampMs,
    model,
    sessionId,
    inputTokens: tokenCount(usage.input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    cacheCreationTokens: tokenCount(usage.cache_creation_input_tokens),
    cacheCreation1hTokens: cacheCreation1h(usage),
    cacheReadTokens: tokenCount(usage.cache_read_input_tokens),
    // Thinking is billed as output; its share is known when the transcript
    // reports output_tokens_details
    reasoningTokens: isRecord(details)
      ? tokenCount(details.thinking_tokens)
      : null,
    reportedCost:
      typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    speed,
    ...(inferenceGeo ? { inferenceGeo } : {}),
    dedupeKey,
  };

  // Top-level usage is the executor's alone. Advisor calls run on another
  // model at its own rates and appear only in `iterations`.
  const requests = [executor];
  const iterations = Array.isArray(usage.iterations) ? usage.iterations : [];
  for (const [index, iteration] of iterations.entries()) {
    if (!isRecord(iteration) || iteration.type !== "advisor_message") continue;
    const advisorModel =
      typeof iteration.model === "string" ? iteration.model : "";
    if (advisorModel.length === 0 || advisorModel === SYNTHETIC_MODEL) continue;
    requests.push({
      timestampMs,
      model: advisorModel,
      sessionId,
      inputTokens: tokenCount(iteration.input_tokens),
      outputTokens: tokenCount(iteration.output_tokens),
      cacheCreationTokens: tokenCount(iteration.cache_creation_input_tokens),
      cacheCreation1hTokens: cacheCreation1h(iteration),
      cacheReadTokens: tokenCount(iteration.cache_read_input_tokens),
      reasoningTokens: null,
      reportedCost: null,
      speed,
      ...(inferenceGeo ? { inferenceGeo } : {}),
      dedupeKey: dedupeKey === null ? null : `${dedupeKey}:advisor:${index}`,
    });
  }
  return requests;
}

export interface ClaudeSource {
  // Config directory, holding settings.json
  configDir: string;
  // Its projects/ directory, holding the transcripts
  projectsDir: string;
}

function expandHome(dir: string): string {
  return dir === "~" || dir.startsWith("~/")
    ? join(homedir(), dir.slice(1))
    : dir;
}

function realPath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Claude Code config directories to read, in the order ccusage looks them up:
 * the configured list, else CLAUDE_CONFIG_DIR (comma-separated), else
 * ~/.config/claude and ~/.claude. An entry may name a config directory or its
 * projects/ directory. Missing defaults are skipped; explicit directories
 * must exist. A directory listed twice is read once.
 */
export function claudeSources(
  configured: readonly string[] | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ClaudeSource[] {
  const fromEnv = env.CLAUDE_CONFIG_DIR?.split(",")
    .map((dir) => dir.trim())
    .filter(Boolean);
  const entries = configured?.length
    ? configured
    : fromEnv?.length
      ? fromEnv
      : [join(homedir(), ".config", "claude"), join(homedir(), ".claude")];
  const explicit = Boolean(configured?.length || fromEnv?.length);
  const sources: ClaudeSource[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const dir = expandHome(entry);
    const projectsDir = realPath(
      basename(dir) === "projects" ? dir : join(dir, "projects"),
    );
    if (projectsDir === null) {
      if (explicit)
        throw new Error(`Cannot read configured Claude Code directory: ${dir}`);
      continue;
    }
    if (seen.has(projectsDir)) continue;
    seen.add(projectsDir);
    sources.push({ configDir: dirname(projectsDir), projectsDir });
  }
  return sources;
}

// Days a transcript survives after its last write
export function claudeRetentionDays(configDir: string): number {
  try {
    const settings: unknown = JSON.parse(
      readFileSync(join(configDir, "settings.json"), "utf8"),
    );
    const days = isRecord(settings) ? settings.cleanupPeriodDays : undefined;
    if (typeof days === "number" && Number.isFinite(days)) {
      return Math.max(1, Math.floor(days));
    }
  } catch {
    // Missing or unreadable settings keep the default
  }
  return DEFAULT_RETENTION_DAYS;
}
