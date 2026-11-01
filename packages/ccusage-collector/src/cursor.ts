import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { queryRows } from "./sqlite.js";
import { SYNC_WINDOW_DAYS, firstDayWithin, type Calendar } from "./calendar.js";
import { RequestBuckets } from "./buckets.js";
import type { DayRange, UsageBucket } from "./types.js";

// ---------------------------------------------------------------------------
// Cursor usage reader
//
// Cursor keeps no billable ledger locally: usage is metered per account in
// the cloud. The local state only holds the session token, so this reader
// takes the token from Cursor's state store, pages through the account's
// usage events from cursor.com, and reports usage per hour and model.
//
// - Token source: `<config>/Cursor/User/globalStorage/state.vscdb`,
//   ItemTable key `cursorAuth/accessToken` (read-only; WAL-safe via sqlite.ts).
//   The token never leaves process memory.
// - Events endpoint (the one the dashboard's usage table uses):
//   POST https://cursor.com/api/dashboard/get-filtered-usage-events
//   with { page, pageSize, startDate, endDate } (epoch milliseconds as
//   strings), authenticated as `WorkosCursorSessionToken={sub}%3A%3A{jwt}`.
//   Cookie variants are retried in order; only 401/403 advances to the next
//   variant. A page holds up to 1,000 events, newest first, as
//   `usageEventsDisplay`, with `totalUsageEventsCount` for the window.
// - Each event is one request: `timestamp` (epoch ms), `model`, and
//   `tokenUsage` with inputTokens (uncached), cacheWriteTokens,
//   cacheReadTokens, outputTokens and totalCents, Cursor's valuation of the
//   request at list price, which keeps Cursor comparable with the other
//   agents' list-price costs. Events without `tokenUsage` (not token-based)
//   carry no usage and are skipped.
// - Window: a normal sync reads the last SYNC_WINDOW_DAYS days and states
//   them completely; a full-history run reads every event. The days are cut
//   in the account calendar.
// - Pages may overlap at their boundaries when events arrive while they are
//   read; the count tells how many duplicates to drop, and they are found as
//   the longest run shared by two neighbouring pages.
// - Failure semantics: transient problems (no state DB, no token, network
//   error, timeout, 429/5xx, an unrecognized page) return an empty skipped
//   result with warnings so scheduled syncs stay quiet. Only exhausted
//   credentials (401/403 on every variant) throw, telling the user to sign
//   in again inside Cursor.
// - Cloud caveat: the events are account-wide, identical on every machine.
//   Enable Cursor on exactly one device per account, otherwise dashboard
//   totals double-count. Re-syncing one device replaces its days.
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const SESSION_COOKIE = "WorkosCursorSessionToken";
const USAGE_EVENTS_PATH = "/api/dashboard/get-filtered-usage-events";
const WEB_BASE_URL = "https://cursor.com";
const PAGE_SIZE = 1000;

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const MAX_FETCH_TIMEOUT_MS = 2_147_483_647;

export interface CursorUsageResult {
  buckets: UsageBucket[];
  // Recent days stated completely; absent when there is no recent usage
  range?: DayRange;
  skipped: boolean;
  warnings: string[];
}

export interface CursorOptions {
  fullHistory?: boolean;
  now?: Date;
}

function emptyResult(warnings: string[] = []): CursorUsageResult {
  return {
    buckets: [],
    skipped: true,
    warnings,
  };
}

/** Thrown when the run should be skipped quietly (transient problem). */
class CursorSkipError extends Error {}

/** Thrown only when stored credentials are dead on every variant. */
class CursorAuthError extends Error {}

export function getCursorStateDbPath(): string | null {
  // Test/fixture override (runtime-only lookup, not a build input)
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const override = process.env.MYCCUSAGE_CURSOR_DB?.trim();
  if (override) return resolve(override);

  // vibe-usage compatible overrides (runtime-only lookup, not a build input)
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const explicit = process.env.CURSOR_STATE_DB_PATH?.trim();
  if (explicit) {
    const resolved = resolve(explicit);
    if (existsSync(resolved)) return resolved;
  }
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const configDirs = process.env.CURSOR_CONFIG_DIR?.trim();
  if (configDirs) {
    for (const dir of configDirs.split(",")) {
      const trimmed = dir.trim();
      if (!trimmed) continue;
      const resolved = resolve(trimmed);
      const candidate = resolved.endsWith(".vscdb")
        ? resolved
        : join(resolved, "User", "globalStorage", "state.vscdb");
      if (existsSync(candidate)) return candidate;
    }
  }

  const relative = join("User", "globalStorage", "state.vscdb");
  let candidate: string;
  if (process.platform === "darwin") {
    candidate = join(
      homedir(),
      "Library",
      "Application Support",
      "Cursor",
      relative,
    );
  } else if (process.platform === "win32") {
    // Runtime-only lookup, not a build input
    const appData =
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
    candidate = join(appData, "Cursor", relative);
  } else {
    const xdg =
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
    candidate = join(xdg, "Cursor", relative);
  }
  return existsSync(candidate) ? candidate : null;
}

function readAccessToken(dbPath: string): string | null {
  const rows = queryRows(
    dbPath,
    `SELECT value FROM ItemTable WHERE key = '${ACCESS_TOKEN_KEY}' LIMIT 1`,
  );
  const value = rows[0]?.value;
  if (typeof value !== "string") return null;
  const token = value.trim();
  return token || null;
}

function decodeJwtSub(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const json = JSON.parse(
      Buffer.from(padded, "base64").toString("utf-8"),
    ) as unknown;
    if (json && typeof json === "object") {
      const sub = (json as Record<string, unknown>).sub;
      return typeof sub === "string" && sub.trim() ? sub.trim() : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveCursorFetchTimeout(value: unknown): number {
  const timeout = Number(value);
  return Number.isInteger(timeout) &&
    timeout > 0 &&
    timeout <= MAX_FETCH_TIMEOUT_MS
    ? timeout
    : DEFAULT_FETCH_TIMEOUT_MS;
}

function dashboardBaseUrl(): string {
  // Mirror override (runtime-only lookup, not a build input)
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const base = process.env.CURSOR_WEB_BASE_URL?.trim();
  return (base || WEB_BASE_URL).replace(/\/+$/, "");
}

// Collect error codes up the cause chain without leaking URLs, headers,
// or tokens that Node embeds in raw network messages.
function networkCodes(error: unknown): string[] {
  const codes = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (err: unknown): void => {
    if (!err || typeof err !== "object" || seen.has(err)) return;
    seen.add(err);
    const record = err as Record<string, unknown>;
    if (
      typeof record.code === "string" &&
      /^[A-Z][A-Z0-9_]{1,63}$/.test(record.code)
    ) {
      codes.add(record.code);
    }
    visit(record.cause);
    if (Array.isArray(record.errors)) record.errors.forEach(visit);
  };
  visit(error);
  return [...codes];
}

// One request of the account
export interface CursorUsageEvent {
  instant: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

interface UsagePage {
  // Events in the window, newest first; absent on a window without usage
  events: unknown[];
  // Events in the whole window, when the page states it
  total?: number;
}

// The usage events of one page. Throws a skip on any shape this reader does
// not understand, so a changed endpoint never uploads partial usage.
export function parseUsagePage(body: unknown): UsagePage {
  if (!isRecord(body))
    throw new CursorSkipError("Cursor usage page is not an object");
  if ("error" in body || "message" in body || "code" in body) {
    throw new CursorSkipError("Cursor usage page is an error response");
  }
  const keys = Object.keys(body);
  if (keys.length === 0) return { events: [] };
  const total = body.totalUsageEventsCount;
  const events =
    keys.length === 1 && keys[0] === "totalUsageEventsCount"
      ? []
      : body.usageEventsDisplay;
  if (
    (total !== undefined &&
      (typeof total !== "number" ||
        !Number.isSafeInteger(total) ||
        total < 0)) ||
    !Array.isArray(events) ||
    events.length > PAGE_SIZE
  ) {
    throw new CursorSkipError("Cursor usage page unrecognized");
  }
  return { events, ...(typeof total === "number" ? { total } : {}) };
}

// One event as a request in the window, or null for an event that carries
// no usage. Throws a skip on an event this reader does not understand.
export function parseUsageEvent(
  raw: unknown,
  [sinceMs, untilMs]: [number, number],
): CursorUsageEvent | null {
  if (!isRecord(raw))
    throw new CursorSkipError("Cursor usage event unrecognized");
  if (raw.tokenUsage === undefined || raw.tokenUsage === null) return null;
  const usage = raw.tokenUsage;
  if (!isRecord(usage))
    throw new CursorSkipError("Cursor usage event unrecognized");
  for (const key of [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "totalCents",
  ]) {
    const value = usage[key];
    if (
      value !== undefined &&
      (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    ) {
      throw new CursorSkipError("Cursor usage event has invalid totals");
    }
  }
  const timestampMs =
    typeof raw.timestamp === "string" && raw.timestamp.trim() !== ""
      ? Number(raw.timestamp)
      : raw.timestamp;
  if (
    typeof timestampMs !== "number" ||
    !Number.isFinite(timestampMs) ||
    typeof raw.model !== "string" ||
    !raw.model
  ) {
    throw new CursorSkipError("Cursor usage event unrecognized");
  }
  if (timestampMs < sinceMs || timestampMs > untilMs) return null;
  const event: CursorUsageEvent = {
    instant: new Date(timestampMs),
    model: raw.model,
    inputTokens: count(usage.inputTokens),
    outputTokens: count(usage.outputTokens),
    cacheCreationTokens: count(usage.cacheWriteTokens),
    cacheReadTokens: count(usage.cacheReadTokens),
    cost: typeof usage.totalCents === "number" ? usage.totalCents / 100 : 0,
  };
  // An errored request, not charged
  const total =
    event.inputTokens +
    event.outputTokens +
    event.cacheCreationTokens +
    event.cacheReadTokens;
  return total === 0 && event.cost === 0 ? null : event;
}

// Length of the longest run that ends `previous` and starts `current`, up to
// `limit`: events that moved from one page to the next while they were read
function boundaryOverlap(
  previous: string[],
  current: string[],
  limit: number,
): number {
  for (let k = Math.min(limit, previous.length, current.length); k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (previous[previous.length - k + i] !== current[i]) {
        same = false;
        break;
      }
    }
    if (same) return k;
  }
  return 0;
}

// Events of all pages, without the duplicates the count announces. Every
// page is complete: a page's events may only repeat the end of the one
// before.
export function dedupePages(pages: unknown[][], total?: number): unknown[] {
  const events: unknown[] = [];
  const raw = pages.reduce((sum, page) => sum + page.length, 0);
  if (total !== undefined && raw < total) {
    throw new CursorSkipError(
      `Cursor usage pages hold ${raw} of ${total} events`,
    );
  }
  let removals = total === undefined ? 0 : raw - total;
  let previous: string[] = [];
  for (const page of pages) {
    const keys = removals > 0 ? page.map((event) => JSON.stringify(event)) : [];
    const overlap = boundaryOverlap(previous, keys, removals);
    removals -= overlap;
    previous = keys;
    events.push(...page.slice(overlap));
  }
  if (removals !== 0) {
    throw new CursorSkipError(
      "Cursor usage pages do not add up to their count",
    );
  }
  return events;
}

const PAGE_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://cursor.com",
  Referer: "https://cursor.com/dashboard?tab=usage",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// Credential headers to try in order; only 401/403 moves on to the next
function credentialVariants(token: string): Record<string, string>[] {
  const sub = decodeJwtSub(token);
  const userId = sub?.includes("|") ? sub.split("|").pop() : null;
  const cookieValues = [
    ...(sub ? [`${sub}%3A%3A${token}`] : []),
    ...(userId ? [`${userId}%3A%3A${token}`] : []),
    token,
  ];
  return [
    ...cookieValues.map((value) => ({ Cookie: `${SESSION_COOKIE}=${value}` })),
    { Authorization: `Bearer ${token}` },
  ];
}

// Pages of the account's usage events in [sinceMs, untilMs], newest first
async function fetchUsagePages(
  token: string,
  [sinceMs, untilMs]: [number, number],
  timeoutMs: number,
): Promise<{ pages: unknown[][]; total?: number }> {
  const url = `${dashboardBaseUrl()}${USAGE_EVENTS_PATH}`;
  const variants = credentialVariants(token);
  const failures: string[] = [];
  // The variant the first page accepted serves the following ones
  let accepted: Record<string, string> | undefined;

  const request = async (
    page: number,
    headers: Record<string, string>,
  ): Promise<Response> => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await fetch(url, {
        method: "POST",
        headers: { ...PAGE_HEADERS, ...headers },
        body: JSON.stringify({
          page,
          pageSize: PAGE_SIZE,
          startDate: String(sinceMs),
          endDate: String(untilMs),
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        throw new CursorSkipError(
          `Cursor usage skipped (timeout after ${timeoutMs}ms on page ${page}). ` +
            `Retry later or raise MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS.`,
        );
      }
      const codes = networkCodes(error);
      throw new CursorSkipError(
        `Cursor usage skipped (network: ${codes.join(", ") || "fetch failed"}). ` +
          `Check terminal network/proxy setup; browser access does not imply Node uses the same proxy.`,
      );
    }
  };

  const readPage = async (page: number): Promise<UsagePage> => {
    for (const headers of accepted ? [accepted] : variants) {
      const resp = await request(page, headers);
      if (resp.ok) {
        accepted = headers;
        let body: unknown;
        try {
          body = await resp.json();
        } catch {
          throw new CursorSkipError("Cursor usage skipped (page is not JSON).");
        }
        return parseUsagePage(body);
      }
      failures.push(`${resp.status} ${resp.statusText}`);
      // Only auth rejections are worth another credential variant; rate
      // limits and server errors are transient states to skip quietly.
      if (resp.status !== 401 && resp.status !== 403) {
        throw new CursorSkipError(
          `Cursor usage skipped (HTTP ${resp.status} ${resp.statusText}).`,
        );
      }
      if (accepted) break;
    }
    throw new CursorAuthError(
      `Cursor session rejected (${failures.join("; ")}). ` +
        `Open Cursor and sign in again, then re-run sync.`,
    );
  };

  const pages: unknown[][] = [];
  let total: number | undefined;
  for (let page = 1; ; page++) {
    // The count can include overlapping page boundaries; allow room to
    // reconcile them without a fixed account-size limit
    const limit =
      total === undefined ? 1000 : Math.ceil(total / PAGE_SIZE) * 2 + 1;
    if (page > limit) {
      throw new CursorSkipError("Cursor usage skipped (too many pages).");
    }
    const result = await readPage(page);
    if (result.total !== undefined) {
      if (total !== undefined && result.total !== total) {
        throw new CursorSkipError(
          "Cursor usage skipped (the event count changed while reading).",
        );
      }
      total = result.total;
    }
    pages.push(result.events);
    if (result.events.length < PAGE_SIZE) break;
  }
  return { pages, ...(total !== undefined ? { total } : {}) };
}

// Each event is one request, summed into its hour per model
export function aggregateCursorUsage(
  events: CursorUsageEvent[],
  calendar: Calendar,
): UsageBucket[] {
  const buckets = new RequestBuckets(calendar);
  for (const { instant, model, ...usage } of events) {
    buckets.add(instant, model, { ...usage, reasoningTokens: null });
  }
  return buckets.list();
}

export async function collectCursorUsage(
  calendar: Calendar,
  options: CursorOptions = {},
): Promise<CursorUsageResult> {
  const timeoutMs = resolveCursorFetchTimeout(
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    process.env.MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS,
  );

  let dbPath: string | null;
  try {
    dbPath = getCursorStateDbPath();
  } catch {
    dbPath = null;
  }
  // No local state means Cursor is not installed here; the scheduled run
  // stays quiet rather than failing the whole sync.
  if (!dbPath || !existsSync(dbPath)) {
    return emptyResult(["Cursor state DB not found; skipping Cursor sync."]);
  }

  let token: string | null;
  try {
    token = readAccessToken(dbPath);
  } catch (error) {
    // Old Node without node:sqlite and without the sqlite3 CLI cannot read
    // the state DB at all; skip with an install hint instead of failing.
    if (
      error instanceof Error &&
      /sqlite3 CLI or Node >= 22\.5/.test(error.message)
    ) {
      return emptyResult([
        "Cursor sync needs SQLite access: install the sqlite3 CLI or use Node >= 22.5.",
      ]);
    }
    throw error;
  }
  if (!token) {
    return emptyResult([
      "No Cursor session token in state DB (not signed in?); skipping Cursor sync.",
    ]);
  }

  const now = options.now ?? new Date();
  const today = calendar.dayOf(now);
  const start = firstDayWithin(calendar, now, SYNC_WINDOW_DAYS);
  const window: [number, number] = [
    options.fullHistory ? 0 : start.getTime(),
    now.getTime(),
  ];

  let events: CursorUsageEvent[];
  try {
    const { pages, total } = await fetchUsagePages(token, window, timeoutMs);
    events = dedupePages(pages, total)
      .map((raw) => parseUsageEvent(raw, window))
      .filter((event): event is CursorUsageEvent => event !== null);
  } catch (error) {
    if (error instanceof CursorSkipError) {
      return emptyResult([error.message]);
    }
    throw error;
  }
  if (events.length === 0) {
    return emptyResult(["Cursor reported no usage events in the window."]);
  }

  const buckets = aggregateCursorUsage(events, calendar);
  const refreshFrom = calendar.dayOf(start);
  const first = buckets.find((bucket) => bucket.date >= refreshFrom)?.date;
  return {
    buckets,
    ...(first ? { range: { from: first, to: today } } : {}),
    skipped: false,
    warnings: [],
  };
}
