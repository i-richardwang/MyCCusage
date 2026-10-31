// Codex rollout parsing, ported from T3 Code
// (https://github.com/pingdotgg/t3code, apps/server/src/provider/Drivers/codexUsage.ts).
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
import { homedir } from "os";
import { join } from "path";
import {
  isRecord,
  parseTimestampMs,
  type RequestSpeed,
  type UsageRequest,
} from "./types.js";

interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

const USAGE_FIELDS: readonly (keyof CodexTokenUsage)[] = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

// Counters must be consistent: cached input is part of input, reasoning part
// of output, and the total covers both.
function isTokenUsage(usage: Record<string, unknown>): boolean {
  if (!USAGE_FIELDS.every((field) => isCount(usage[field]))) return false;
  const u = usage as unknown as CodexTokenUsage;
  return (
    u.cached_input_tokens + u.cache_write_input_tokens <= u.input_tokens &&
    u.reasoning_output_tokens <= u.output_tokens &&
    u.total_tokens >= u.input_tokens + u.output_tokens
  );
}

function readTokenUsage(value: unknown): CodexTokenUsage | null {
  if (!isRecord(value)) return null;
  const input = value.input_tokens;
  const output = value.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  const usage = {
    input_tokens: input,
    cached_input_tokens: value.cached_input_tokens ?? 0,
    cache_write_input_tokens: value.cache_write_input_tokens ?? 0,
    output_tokens: output,
    reasoning_output_tokens: value.reasoning_output_tokens ?? 0,
    total_tokens: value.total_tokens ?? input + output,
  };
  return isTokenUsage(usage) ? (usage as CodexTokenUsage) : null;
}

function advanceUsage(
  previous: CodexTokenUsage | null,
  last: CodexTokenUsage,
): CodexTokenUsage | null {
  return readTokenUsage(
    Object.fromEntries(
      USAGE_FIELDS.map((key) => [key, (previous?.[key] ?? 0) + last[key]]),
    ),
  );
}

function rebaseUsage(state: CodexScanState, cumulative: CodexTokenUsage): void {
  state.lastCumulativeUsage = cumulative;
  if (cumulative.input_tokens + cumulative.output_tokens === 0) {
    delete state.sequenceStartSignature;
  }
}

/**
 * `token_count` events carry no model or service tier, so both carry forward
 * through the file: the model from the latest `turn_context`, the tier from
 * the latest `thread_settings_applied`.
 */
export interface CodexScanState {
  model: string;
  speed: RequestSpeed;
  sessionId: string;
  lastUsageSignature: string | null;
  lastCumulativeUsage: CodexTokenUsage | null;
  // Usage events skipped as inconsistent
  malformedRecords: number;
  sequenceStartSignature?: string;
  sawSessionMeta: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    speed: "standard",
    sessionId: "",
    lastUsageSignature: null,
    lastCumulativeUsage: null,
    malformedRecords: 0,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

// Forks copy and restamp parent history in a burst (0-40ms gaps); genuine
// child usage follows a model turn (5s+ observed).
const FORK_COPY_MAX_GAP_MS = 1000;

function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload.forked_from_id === "string") return true;
  const source = payload.source;
  if (!isRecord(source) || !isRecord(source.subagent)) return false;
  const spawn = source.subagent.thread_spawn;
  return isRecord(spawn) && typeof spawn.parent_thread_id === "string";
}

// Missing, default and standard tiers bill as standard; "fast" aliases priority.
function tierSpeed(serviceTier: unknown): RequestSpeed {
  if (serviceTier === "priority" || serviceTier === "fast") return "fast";
  if (serviceTier === "ultrafast") return "ultrafast";
  return "standard";
}

const MARKERS = [
  '"token_count"',
  '"turn_context"',
  '"thread_settings_applied"',
  '"session_meta"',
];

/**
 * Cumulative counters validate each request's delta; events without them are
 * deduplicated by dropping consecutive repeats.
 */
export function parseCodexLine(
  line: string,
  state: CodexScanState,
): UsageRequest | null {
  if (!MARKERS.some((marker) => line.includes(marker))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.payload)) return null;
  const payload = parsed.payload;

  if (parsed.type === "session_meta") {
    // Only the first meta identifies the session; copied ancestor metas
    // would misattribute later records.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payload.id ?? payload.session_id;
    if (typeof id === "string") state.sessionId = id;
    const metaTimestampMs = parseTimestampMs(parsed.timestamp);
    if (metaTimestampMs !== null && isForkedSessionMeta(payload)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (parsed.type === "turn_context") {
    if (typeof payload.model === "string") state.model = payload.model;
    return null;
  }

  if (payload.type === "thread_settings_applied") {
    const settings = payload.thread_settings;
    if (isRecord(settings)) state.speed = tierSpeed(settings.service_tier);
    return null;
  }

  if (payload.type !== "token_count" || !isRecord(payload.info)) return null;
  const info = payload.info;

  // Codex may re-emit these counters once the model or timestamp is known
  const timestampMs = parseTimestampMs(parsed.timestamp);
  if (timestampMs === null || state.model.length === 0) return null;

  const last = readTokenUsage(info.last_token_usage);
  const rawCumulative = info.total_token_usage;
  const hasCumulative = rawCumulative !== undefined && rawCumulative !== null;
  const cumulative = hasCumulative ? readTokenUsage(rawCumulative) : null;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      // Copied history is billed in the parent, but sets the child's baseline
      const signature = last === null ? null : JSON.stringify(last);
      if (cumulative !== null) rebaseUsage(state, cumulative);
      else if (
        !hasCumulative &&
        last !== null &&
        signature !== state.lastUsageSignature
      ) {
        state.lastCumulativeUsage = advanceUsage(
          state.lastCumulativeUsage,
          last,
        );
      }
      state.lastUsageSignature = signature;
      return null;
    }
    state.suppressingForkCopies = false;
    state.lastUsageSignature = null;
  }

  const previous = state.lastCumulativeUsage;
  // A valid snapshot stays the next baseline even if its request is malformed
  if (cumulative !== null) rebaseUsage(state, cumulative);
  if (last === null || (hasCumulative && cumulative === null)) {
    state.malformedRecords += 1;
    return null;
  }

  // Zero-component counters report context size, not a request
  if (last.input_tokens + last.output_tokens === 0) {
    state.lastUsageSignature = null;
    return null;
  }

  if (
    cumulative !== null &&
    previous !== null &&
    USAGE_FIELDS.every((key) => cumulative[key] === previous[key])
  ) {
    return null;
  }

  if (last.total_tokens !== last.input_tokens + last.output_tokens) {
    state.malformedRecords += 1;
    return null;
  }

  const signature = JSON.stringify(last);
  if (cumulative !== null) {
    // A session resumed in a new process restarts its cumulative counters
    const restarted = USAGE_FIELDS.every(
      (key) => cumulative[key] === last[key],
    );
    const sequenceStart = JSON.stringify([timestampMs, last]);
    if (restarted && sequenceStart === state.sequenceStartSignature) {
      state.lastCumulativeUsage = previous;
      return null;
    }
    // Forks and continuations can inherit totals without a counter snapshot;
    // bill only the latest request, and require the unseen prefix to be valid
    const reconciled =
      previous === null
        ? readTokenUsage(
            Object.fromEntries(
              USAGE_FIELDS.map((key) => [key, cumulative[key] - last[key]]),
            ),
          ) !== null
        : USAGE_FIELDS.every(
            (key) => cumulative[key] - previous[key] === last[key],
          );
    if (!restarted && !reconciled) {
      state.malformedRecords += 1;
      return null;
    }
    if (restarted) state.sequenceStartSignature = sequenceStart;
  } else {
    if (signature === state.lastUsageSignature) return null;
    // Advance expected totals so a later cumulative re-emission is stale
    const advanced = advanceUsage(previous, last);
    if (advanced === null) {
      state.malformedRecords += 1;
      return null;
    }
    state.lastCumulativeUsage = advanced;
  }
  state.lastUsageSignature = signature;

  return {
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    // Codex reports input inclusive of cached reads and writes
    inputTokens:
      last.input_tokens -
      last.cached_input_tokens -
      last.cache_write_input_tokens,
    outputTokens: last.output_tokens,
    cacheCreationTokens: last.cache_write_input_tokens,
    cacheCreation1hTokens: 0,
    cacheReadTokens: last.cached_input_tokens,
    reasoningTokens: last.reasoning_output_tokens,
    reportedCost: null,
    speed: state.speed,
    dedupeKey: null,
  };
}

// Live and archived rollouts. Archiving moves a rollout, so a scan between
// the two can see a session in both; the caller deduplicates across files.
export function codexSessionDirs(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex");
  return [join(home, "sessions"), join(home, "archived_sessions")];
}
