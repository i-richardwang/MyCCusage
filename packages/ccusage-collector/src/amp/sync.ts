import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Calendar } from "../calendar.js";
import type { AmpRunner } from "./cli.js";
import { parseThreadUsageReport, type AmpDayReport } from "./report.js";
import {
  isValidThreadId,
  projectThreadExport,
  reportIsCurrent,
  reportKey,
  threadActiveDays,
  type AmpCachedThread,
} from "./threads.js";

// Cache layout under ~/.ccusage-collector/amp-cache/:
//   index.json         sync state (see AmpSyncIndex)
//   threads/T-*.json   one AmpCachedThread per thread
//
// A sync runs two phases. Exports are refreshed when a thread's `updated`
// changes, so main-agent usage is always current. Usage reports are rate
// limited by Amp, so they are fetched afterwards within an hourly budget,
// newest days first.

const LIST_PAGE_SIZE = 200;
const MAX_CONCURRENT_EXPORTS = 4;
const MAX_CONCURRENT_REPORTS = 2;
const SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Amp allows 60 usage reports per hour; leave headroom for the user's own
// `amp usage` calls.
export const REPORTS_PER_HOUR = 40;
// Bump when the cache layout changes; a mismatch rebuilds the cache.
const CACHE_VERSION = 2;

interface AmpSyncIndex {
  version: number;
  installationId: string;
  // Thread id -> `updated` reported by `amp threads list` at export time
  threads: Record<string, string>;
  // Usage report request times within the last hour
  reportRequests: string[];
  // Set when Amp rejects usage reports for exceeding its hourly limit
  reportsBlockedUntil?: string;
}

interface AmpThreadSummary {
  id: string;
  updated: string;
}

export interface AmpSyncResult {
  listed: number;
  exported: number;
  unchanged: number;
  failed: number;
  // Threads left for the next run when the sync timed out
  deferred: number;
  reportsFetched: number;
  reportsPending: number;
}

function defaultCacheDir(): string {
  return join(homedir(), ".ccusage-collector", "amp-cache");
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Load the index, or start a fresh cache when it is missing, from another
// cache version, or for another installation. Rate-limit state is per
// account, so it survives a rebuild.
function openCache(
  cacheDir: string,
  threadsDir: string,
  installationId: string,
): AmpSyncIndex {
  const index = readJson<AmpSyncIndex>(join(cacheDir, "index.json"));
  if (index?.version === CACHE_VERSION && index.installationId === installationId) {
    return index;
  }
  rmSync(threadsDir, { recursive: true, force: true });
  return {
    version: CACHE_VERSION,
    installationId,
    threads: {},
    reportRequests: index?.reportRequests ?? [],
    reportsBlockedUntil: index?.reportsBlockedUntil,
  };
}

async function listThreads(
  run: AmpRunner,
  installationId: string,
  deadline: number,
): Promise<AmpThreadSummary[]> {
  const threads: AmpThreadSummary[] = [];
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("timed out while listing Amp threads");
    const stdout = await run(
      [
        "threads",
        "list",
        "--json",
        "--include-archived",
        "--installation-id",
        installationId,
        "--limit",
        String(LIST_PAGE_SIZE),
        "--offset",
        String(threads.length),
      ],
      remaining,
    );
    const page = JSON.parse(stdout);
    if (!Array.isArray(page)) {
      throw new Error("`amp threads list --json` returned unexpected output");
    }
    threads.push(...(page as AmpThreadSummary[]));
    if (page.length < LIST_PAGE_SIZE) return threads;
  }
}

// Run `worker` over `items` with at most `concurrency` in flight. A worker
// returning false stops handing out further items; returns how many items
// were never started.
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<boolean | void>,
): Promise<number> {
  let next = 0;
  let stopped = false;
  const lane = async () => {
    while (!stopped && next < items.length) {
      if ((await worker(items[next++]!)) === false) stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  );
  return items.length - next;
}

// Phase 1: export threads whose `updated` changed, keeping their cached
// reports; phase 2 decides which of those are stale.
async function syncExports(
  run: AmpRunner,
  threadsDir: string,
  index: AmpSyncIndex,
  pending: AmpThreadSummary[],
  deadline: number,
  result: AmpSyncResult,
): Promise<void> {
  const failures: string[] = [];
  const notStarted = await runPool(pending, MAX_CONCURRENT_EXPORTS, async (summary) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      result.deferred++;
      return false;
    }
    try {
      const raw = await run(["threads", "export", summary.id], remaining);
      const path = join(threadsDir, `${summary.id}.json`);
      const thread: AmpCachedThread = {
        ...projectThreadExport(raw, summary.id),
        updated: summary.updated,
        reports: readJson<AmpCachedThread>(path)?.reports ?? {},
      };
      atomicWrite(path, JSON.stringify(thread));
      index.threads[summary.id] = summary.updated;
      result.exported++;
    } catch (error) {
      // Cut off by the deadline: retry next run, not a failure
      if (Date.now() >= deadline) {
        result.deferred++;
        return false;
      }
      result.failed++;
      failures.push(`${summary.id}: ${errorMessage(error)}`);
    }
  });
  result.deferred += notStarted;

  if (failures.length > 0) {
    console.warn(
      `${failures.length} Amp thread export(s) failed (first: ${failures[0]})`,
    );
  }
}

function reportBudget(index: AmpSyncIndex, now: number): number {
  index.reportRequests = index.reportRequests.filter(
    (at) => now - new Date(at).getTime() < HOUR_MS,
  );
  const blocked =
    index.reportsBlockedUntil !== undefined &&
    new Date(index.reportsBlockedUntil).getTime() > now;
  return blocked ? 0 : Math.max(REPORTS_PER_HOUR - index.reportRequests.length, 0);
}

// Phase 2: fetch missing or stale day reports, newest days first, within the
// hourly budget. Stops for an hour once Amp reports its limit was hit.
async function syncReports(
  run: AmpRunner,
  threadsDir: string,
  index: AmpSyncIndex,
  threadIds: string[],
  calendar: Calendar,
  deadline: number,
  result: AmpSyncResult,
): Promise<void> {
  const needed: Array<{ thread: AmpCachedThread; date: string }> = [];
  for (const id of threadIds) {
    const thread = readJson<AmpCachedThread>(join(threadsDir, `${id}.json`));
    if (!thread) continue;
    for (const date of threadActiveDays(thread, calendar)) {
      if (!reportIsCurrent(thread, date, calendar)) needed.push({ thread, date });
    }
  }
  needed.sort((a, b) => b.date.localeCompare(a.date));

  const updated = new Set<AmpCachedThread>();
  const failures: string[] = [];
  const parseErrors: string[] = [];
  const budget = reportBudget(index, Date.now());
  await runPool(needed.slice(0, budget), MAX_CONCURRENT_REPORTS, async ({ thread, date }) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    const range = calendar.rangeOf(date);
    const [start, end] = range;
    const fetchedAt = new Date().toISOString();
    index.reportRequests.push(fetchedAt);

    let text: string;
    try {
      text = await run(
        [
          "threads",
          "usage",
          thread.id,
          "--details",
          "--start",
          start.toISOString(),
          "--end",
          end.toISOString(),
        ],
        remaining,
      );
    } catch (error) {
      const message = errorMessage(error);
      if (/requests per hour/i.test(message)) {
        index.reportsBlockedUntil = new Date(Date.now() + HOUR_MS).toISOString();
        return false;
      }
      failures.push(`${thread.id} ${date}: ${message}`);
      return;
    }
    // Usage of a just-active thread may not be available yet; retry later
    if (/currently unavailable/i.test(text)) return;

    let report: AmpDayReport | null;
    try {
      report = parseThreadUsageReport(text);
    } catch (error) {
      // A changed report format must not block syncing; that day counts the
      // main agent only
      report = null;
      parseErrors.push(`${thread.id} ${date}: ${errorMessage(error)}`);
    }
    thread.reports[reportKey(range)] = { fetchedAt, report };
    updated.add(thread);
    result.reportsFetched++;
  });

  for (const thread of updated) {
    atomicWrite(join(threadsDir, `${thread.id}.json`), JSON.stringify(thread));
  }
  result.reportsPending = needed.length - result.reportsFetched;

  if (failures.length > 0) {
    console.warn(
      `${failures.length} Amp usage report(s) failed (first: ${failures[0]})`,
    );
  }
  if (parseErrors.length > 0) {
    console.warn(
      `${parseErrors.length} Amp usage report(s) could not be parsed; those days count the main agent only (first: ${parseErrors[0]})`,
    );
  }
}

// Incrementally refresh the local cache. Threads no longer listed (deleted)
// keep their cached usage: the tokens were still spent.
export async function syncAmpCache(
  run: AmpRunner,
  installationId: string,
  calendar: Calendar,
  cacheDir: string = defaultCacheDir(),
  timeoutMs: number = SYNC_TIMEOUT_MS,
): Promise<AmpSyncResult> {
  const deadline = Date.now() + timeoutMs;
  const threadsDir = join(cacheDir, "threads");
  const index = openCache(cacheDir, threadsDir, installationId);
  mkdirSync(threadsDir, { recursive: true, mode: 0o700 });

  const listed = await listThreads(run, installationId, deadline);
  const valid = listed.filter((t) => isValidThreadId(t.id));
  const pending = valid.filter(
    (t) =>
      index.threads[t.id] !== t.updated ||
      !existsSync(join(threadsDir, `${t.id}.json`)),
  );

  const result: AmpSyncResult = {
    listed: listed.length,
    exported: 0,
    unchanged: valid.length - pending.length,
    failed: listed.length - valid.length,
    deferred: 0,
    reportsFetched: 0,
    reportsPending: 0,
  };

  try {
    await syncExports(run, threadsDir, index, pending, deadline, result);
    await syncReports(
      run,
      threadsDir,
      index,
      valid.map((t) => t.id),
      calendar,
      deadline,
      result,
    );
  } finally {
    atomicWrite(join(cacheDir, "index.json"), JSON.stringify(index, null, 2));
  }
  return result;
}

export function loadCachedThreads(
  cacheDir: string = defaultCacheDir(),
): AmpCachedThread[] {
  const threadsDir = join(cacheDir, "threads");
  if (!existsSync(threadsDir)) return [];
  return readdirSync(threadsDir)
    .filter((name) => name.startsWith("T-") && name.endsWith(".json"))
    .map((name) => readJson<AmpCachedThread>(join(threadsDir, name)))
    .filter((thread): thread is AmpCachedThread => thread !== null);
}
