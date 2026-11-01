import { existsSync } from "fs";
import { addDays, type Calendar } from "../calendar.js";
import { estimateRequestCost, type PricingTable } from "../pricing/rates.js";
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

// Days re-read on every sync. Older days keep what earlier syncs uploaded.
const HOURLY_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TranscriptCollection {
  // Recent days covered completely; absent when there is no recent usage
  range?: DayRange;
  backfillBefore?: string;
  buckets: UsageBucket[];
  // Models without known prices; their tokens count at zero cost
  unpricedModels: string[];
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
  // How many days back every transcript is still on disk
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
): Pick<TranscriptCollection, "buckets" | "unpricedModels"> {
  const seen = new Set<string>();
  const buckets = new RequestBuckets(calendar);
  const unpriced = new Set<string>();
  for (const requests of files) {
    for (const request of requests) {
      if (request.dedupeKey !== null) {
        if (seen.has(request.dedupeKey)) continue;
        seen.add(request.dedupeKey);
      }
      if (request.timestampMs < startMs || request.timestampMs >= endMs) {
        continue;
      }
      let cost = request.reportedCost;
      if (cost === null) {
        const models = request.rateModel
          ? [request.model, request.rateModel]
          : [request.model];
        const estimate = estimateRequestCost(pricing, models, request);
        if (!estimate) unpriced.add(request.model);
        cost = estimate?.cost ?? 0;
      }
      buckets.add(new Date(request.timestampMs), request.model, {
        inputTokens: request.inputTokens,
        outputTokens: request.outputTokens,
        cacheCreationTokens: request.cacheCreationTokens,
        cacheReadTokens: request.cacheReadTokens,
        reasoningTokens: request.reasoningTokens,
        cost,
      });
    }
  }
  return { buckets: buckets.list(), unpricedModels: [...unpriced].sort() };
}

/**
 * Hourly usage of the last days whose transcripts are all still on disk, up
 * to HOURLY_WINDOW_DAYS. The range ends today and starts no earlier than the
 * first request found, so transcripts lost with a reinstalled machine never
 * erase days the dashboard already holds. Days before the range keep what
 * earlier syncs stored. Full-history scans also include older buckets, marked
 * for insertion only on days the server does not already hold.
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
  const days = Math.min(HOURLY_WINDOW_DAYS, source.completeDays);
  // The first whole day after the instant `days` × 24h ago, as retention
  // counts: a 25-hour DST day in the window never lets it reach further
  const cutoff = new Date(now.getTime() - days * DAY_MS);
  const [start] = calendar.rangeOf(addDays(calendar.dayOf(cutoff), 1));
  const [, end] = calendar.rangeOf(today);
  const sinceMs = options.fullHistory ? -Infinity : start.getTime();

  const { files, malformedRecords } = await source.read(sinceMs);
  const usage = {
    ...bucketRequests(files, calendar, pricing, [sinceMs, end.getTime()]),
    malformedRecords,
  };
  const refreshFrom = calendar.dayOf(start);
  const first = usage.buckets.find(
    (bucket) => bucket.date >= refreshFrom,
  )?.date;
  return {
    ...usage,
    ...(first ? { range: { from: first, to: today } } : {}),
    ...(options.fullHistory ? { backfillBefore: refreshFrom } : {}),
  };
}
