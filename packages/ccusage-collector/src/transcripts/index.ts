import { existsSync } from "fs";
import {
  SYNC_WINDOW_DAYS,
  firstDayWithin,
  type Calendar,
} from "../calendar.js";
import { priceRequest, type PricingTable } from "../pricing/rates.js";
import { RequestBuckets } from "../buckets.js";
import type { DayRange, UsageBucket } from "../types.js";
import {
  antigravityConversationDirs,
  readAntigravityUsage,
} from "./antigravity.js";
import {
  claudeRetentionDays,
  claudeSources,
  parseClaudeLine,
} from "./claude.js";
import {
  codexSessionDirs,
  initialCodexScanState,
  parseCodexLine,
} from "./codex.js";
import { listTranscriptFiles, readLines } from "./files.js";
import { openCodeDataDirs, readOpenCodeUsage } from "./opencode.js";
import type { UsageRequest } from "./types.js";

// Agents whose transcripts record every request with its time
export type TranscriptAgent =
  | "claude-code"
  | "codex"
  | "opencode"
  | "antigravity";

export interface TranscriptCollection {
  // Recent days covered completely; absent when there is no recent usage
  range?: DayRange;
  // On a full-history scan of an agent that deletes old transcripts: the
  // first day every transcript of is still kept. Earlier days may be partial
  backfillBefore?: string;
  buckets: UsageBucket[];
  // Usage records skipped as inconsistent
  malformedRecords: number;
}

interface TranscriptOptions {
  claudeConfigDirs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fullHistory?: boolean;
}

// Requests read from transcripts, one list per file
interface TranscriptRequests {
  files: UsageRequest[][];
  malformedRecords: number;
}

interface TranscriptSource {
  // How many days back every transcript is still on disk; Infinity for an
  // agent that never deletes its transcripts
  completeDays: number;
  // Every request made at or after sinceMs
  read(sinceMs: number): Promise<TranscriptRequests>;
}

// The requests of one transcript file
interface FileRequests {
  requests: UsageRequest[];
  malformedRecords: number;
}

// JSONL transcripts under `dirs`, one request list per file
async function readJsonl(
  dirs: readonly string[],
  sinceMs: number,
  parse: (path: string) => Promise<FileRequests>,
): Promise<TranscriptRequests> {
  const files: UsageRequest[][] = [];
  let malformedRecords = 0;
  for (const dir of dirs) {
    for (const file of await listTranscriptFiles(dir, sinceMs)) {
      const read = await parse(file);
      files.push(read.requests);
      malformedRecords += read.malformedRecords;
    }
  }
  return { files, malformedRecords };
}

async function readClaudeFile(path: string): Promise<FileRequests> {
  const requests: UsageRequest[] = [];
  for await (const line of readLines(path)) {
    requests.push(...parseClaudeLine(line));
  }
  return { requests, malformedRecords: 0 };
}

async function readCodexFile(path: string): Promise<FileRequests> {
  const requests: UsageRequest[] = [];
  const state = initialCodexScanState();
  for await (const line of readLines(path)) {
    const request = parseCodexLine(line, state);
    if (request) requests.push(request);
  }
  return { requests, malformedRecords: state.malformedRecords };
}

// Codex keys requests only when a session appears in several files, as a
// rollout moved to the archive mid-scan does. Within one file, equal events
// stay distinct by their occurrence.
function keySharedSessions(files: UsageRequest[][]): void {
  const fileOf = new Map<string, number>();
  const shared = new Set<string>();
  for (const [index, requests] of files.entries()) {
    for (const { sessionId } of requests) {
      if (!sessionId) continue;
      const first = fileOf.get(sessionId);
      if (first === undefined) fileOf.set(sessionId, index);
      else if (first !== index) shared.add(sessionId);
    }
  }
  if (shared.size === 0) return;
  for (const requests of files) {
    const occurrences = new Map<string, number>();
    for (const request of requests) {
      if (!shared.has(request.sessionId)) continue;
      const key = JSON.stringify([
        request.sessionId,
        request.timestampMs,
        request.model,
        request.inputTokens,
        request.outputTokens,
        request.cacheCreationTokens,
        request.cacheReadTokens,
      ]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      request.dedupeKey = `${key}:${occurrence}`;
    }
  }
}

// Where an agent keeps its transcripts, and how to read them. An agent
// without any data directory fails: an empty result would erase stored days.
function transcriptSource(
  agent: TranscriptAgent,
  options: TranscriptOptions,
): TranscriptSource {
  const env = options.env ?? process.env;
  switch (agent) {
    case "claude-code": {
      const sources = claudeSources(options.claudeConfigDirs, env);
      if (sources.length === 0) {
        throw new Error(
          "No Claude Code transcripts found; set claudeConfigDirs to the config directories Claude Code uses",
        );
      }
      const dirs = sources.map(({ projectsDir }) => projectsDir);
      return {
        // A day is complete only while no transcript touching it can have
        // been deleted: Claude Code removes transcripts by their last write
        completeDays: Math.min(
          ...sources.map(({ configDir }) => claudeRetentionDays(configDir)),
        ),
        read: (sinceMs) => readJsonl(dirs, sinceMs, readClaudeFile),
      };
    }
    case "codex": {
      const dirs = codexSessionDirs(env).filter((dir) => existsSync(dir));
      if (dirs.length === 0) {
        throw new Error(
          "No Codex sessions found; set CODEX_HOME to the directory Codex uses",
        );
      }
      return {
        completeDays: Infinity,
        read: async (sinceMs) => {
          const read = await readJsonl(dirs, sinceMs, readCodexFile);
          keySharedSessions(read.files);
          return read;
        },
      };
    }
    case "opencode": {
      const dirs = openCodeDataDirs(env);
      if (dirs.length === 0) {
        throw new Error(
          "No OpenCode data found; set OPENCODE_DATA_DIR to the data directory OpenCode uses",
        );
      }
      return {
        completeDays: Infinity,
        read: async (sinceMs) => {
          const files: UsageRequest[][] = [];
          for (const dir of dirs) {
            files.push(...(await readOpenCodeUsage(dir, sinceMs)));
          }
          return { files, malformedRecords: 0 };
        },
      };
    }
    case "antigravity": {
      const dirs = antigravityConversationDirs(env);
      if (dirs.length === 0) {
        throw new Error(
          "No Antigravity conversations found; set ANTIGRAVITY_DATA_DIR to the data directory Antigravity uses",
        );
      }
      return {
        completeDays: Infinity,
        read: async (sinceMs) => ({
          files: await readAntigravityUsage(dirs, sinceMs),
          malformedRecords: 0,
        }),
      };
    }
  }
}

/**
 * Sum requests into account-calendar hours per model, counting each request
 * once and keeping only those inside [startMs, endMs). Requests are priced one
 * by one, so long-context, cache lifetime and speed surcharges apply exactly.
 */
export function bucketRequests(
  files: UsageRequest[][],
  calendar: Calendar,
  pricing: PricingTable,
  [startMs, endMs]: [number, number],
): UsageBucket[] {
  const seen = new Set<string>();
  const buckets = new RequestBuckets(calendar);
  for (const requests of files) {
    for (const request of requests) {
      if (request.dedupeKey !== null) {
        if (seen.has(request.dedupeKey)) continue;
        seen.add(request.dedupeKey);
      }
      if (request.timestampMs < startMs || request.timestampMs >= endMs) {
        continue;
      }
      const models = request.rateModel
        ? [request.model, request.rateModel]
        : [request.model];
      const priced = priceRequest(
        pricing,
        models,
        request,
        request.reportedCost,
      );
      buckets.add(new Date(request.timestampMs), request.model, {
        inputTokens: request.inputTokens,
        outputTokens: request.outputTokens,
        cacheCreationTokens: request.cacheCreationTokens,
        cacheReadTokens: request.cacheReadTokens,
        reasoningTokens: request.reasoningTokens,
        ...priced,
      });
    }
  }
  return buckets.list();
}

/**
 * Hourly usage of the last days whose transcripts are all still on disk, up
 * to SYNC_WINDOW_DAYS. The range ends today and starts no earlier than the
 * first request found, so transcripts lost with a reinstalled machine never
 * erase days the dashboard already holds. Days before the range keep what
 * earlier syncs stored.
 *
 * A full-history scan also buckets every older request, and each day it
 * covers replaces the stored one while the agent still keeps all of its
 * transcripts. Where the agent deletes old transcripts, a day before the
 * retention period may be read from a surviving part of its sessions only,
 * so such days are marked for insertion where the server holds nothing yet.
 */
export async function collectTranscriptUsage(
  agent: TranscriptAgent,
  calendar: Calendar,
  pricing: PricingTable,
  options: TranscriptOptions = {},
): Promise<TranscriptCollection> {
  const source = transcriptSource(agent, options);
  const now = options.now ?? new Date();
  const today = calendar.dayOf(now);
  const start = firstDayWithin(
    calendar,
    now,
    Math.min(SYNC_WINDOW_DAYS, source.completeDays),
  );
  const [, end] = calendar.rangeOf(today);
  const sinceMs = options.fullHistory ? -Infinity : start.getTime();

  const { files, malformedRecords } = await source.read(sinceMs);
  const usage = {
    buckets: bucketRequests(files, calendar, pricing, [sinceMs, end.getTime()]),
    malformedRecords,
  };
  const refreshFrom = calendar.dayOf(start);
  const first = usage.buckets.find(
    (bucket) => bucket.date >= refreshFrom,
  )?.date;
  const backfillBefore =
    options.fullHistory && Number.isFinite(source.completeDays)
      ? calendar.dayOf(firstDayWithin(calendar, now, source.completeDays))
      : undefined;
  return {
    ...usage,
    ...(first ? { range: { from: first, to: today } } : {}),
    ...(backfillBefore ? { backfillBefore } : {}),
  };
}
