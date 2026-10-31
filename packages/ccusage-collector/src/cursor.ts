import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { queryRows } from "./sqlite.js";
import type { Calendar } from "./calendar.js";
import { RequestBuckets } from "./buckets.js";
import type { UsageBucket } from "./types.js";

// ---------------------------------------------------------------------------
// Cursor usage parser
//
// Cursor has no ccusage support and keeps no billable ledger locally: usage
// is metered per account in the cloud. The local state only holds the
// session token, so this parser reads the token from Cursor's state store,
// downloads the per-request CSV export from cursor.com, and reports usage per
// hour and model.
//
// - Token source: `<config>/Cursor/User/globalStorage/state.vscdb`,
//   ItemTable key `cursorAuth/accessToken` (read-only; WAL-safe via sqlite.ts).
//   The token never leaves process memory.
// - Export endpoint (same one the dashboard uses):
//   GET https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens
//   authenticated as `WorkosCursorSessionToken={sub}%3A%3A{jwt}`, with
//   browser-mimicking headers. Cookie variants are retried in order; only
//   401/403 advances to the next variant.
// - CSV columns: Date, Model, Input (w/ Cache Write),
//   Input (w/o Cache Write), Cache Read, Output Tokens, Total Tokens, Cost,
//   Cost to you. Column semantics (cross-checked against two independent
//   implementations, vibe-usage and tokscale, plus a third-party billing
//   breakdown):
//   - "w/o" is the plain input count; "w/ minus w/o" is the cache-write
//     portion (the export has no standalone write column, so the write
//     amount is only recoverable as this difference). Either reading gives
//     the same four-counter total; this one additionally preserves the
//     cache-creation split our schema expects.
//   - "Cost" is the list/API valuation and is preferred so Cursor stays
//     comparable with the other agents' list-price costs (which the
//     dashboard compares against subscription plans); "Cost to you"
//     (post-plan charge) is the fallback.
//   - Total Tokens is not trusted: the dashboard totals the four counters.
// - Failure semantics: transient problems (no state DB, no token, network
//   error, timeout, 429/5xx, unrecognized header) return an empty skipped
//   result with warnings so scheduled syncs stay quiet. Only exhausted
//   credentials (401/403 on every variant) throw, telling the user to sign
//   in again inside Cursor. A renamed export header is treated as a skip,
//   never as an empty upload.
// - Cloud caveat: the export is account-wide, identical on every machine.
//   Enable Cursor on exactly one device per account, otherwise dashboard
//   totals double-count. Re-syncing one device replaces its days.
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const SESSION_COOKIE = "WorkosCursorSessionToken";
const EXPORT_PATH = "/api/dashboard/export-usage-events-csv?strategy=tokens";
const WEB_BASE_URL = "https://cursor.com";

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;
const MAX_FETCH_TIMEOUT_MS = 2_147_483_647;

export interface CursorUsageResult {
  buckets: UsageBucket[];
  skipped: boolean;
  warnings: string[];
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
        : join(
            resolved,
            "User",
            "globalStorage",
            "state.vscdb",
          );
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
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const xdg = process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
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

function exportBaseUrl(): string {
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

async function fetchUsageCsv(
  token: string,
  timeoutMs: number,
): Promise<string> {
  const url = `${exportBaseUrl()}${EXPORT_PATH}`;
  const sub = decodeJwtSub(token);
  const userId = sub?.includes("|") ? sub.split("|").pop() : null;
  const cookieValues = [
    ...(sub ? [`${sub}%3A%3A${token}`] : []),
    ...(userId ? [`${userId}%3A%3A${token}`] : []),
    token,
  ];

  const baseHeaders = {
    Accept: "text/csv,*/*;q=0.8",
    Origin: "https://cursor.com",
    Referer: "https://cursor.com/dashboard?tab=usage",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  };
  const attempts: Record<string, string>[] = cookieValues.map((value) => ({
    Cookie: `${SESSION_COOKIE}=${value}`,
  }));
  attempts.push({ Authorization: `Bearer ${token}` });

  const failures: string[] = [];
  for (const headers of attempts) {
    const signal = AbortSignal.timeout(timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(url, { headers: { ...baseHeaders, ...headers }, signal });
    } catch (error) {
      if (signal.aborted) {
        throw new CursorSkipError(
          `Cursor usage export skipped (timeout after ${timeoutMs}ms). ` +
            `The export is computed over the whole account and slow for heavy users; ` +
            `retry later or raise MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS.`,
        );
      }
      const codes = networkCodes(error);
      throw new CursorSkipError(
        `Cursor usage export skipped (network: ${codes.join(", ") || "fetch failed"}). ` +
          `Check terminal network/proxy setup; browser access does not imply Node uses the same proxy.`,
      );
    }
    if (resp.ok) {
      try {
        return await resp.text();
      } catch (error) {
        if (signal.aborted) {
          throw new CursorSkipError(
            `Cursor usage export skipped (timeout after ${timeoutMs}ms). ` +
              `Raise MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS and retry.`,
          );
        }
        const codes = networkCodes(error);
        throw new CursorSkipError(
          `Cursor usage export skipped (network: ${codes.join(", ") || "fetch failed"}).`,
        );
      }
    }
    failures.push(`${resp.status} ${resp.statusText}`);
    // Only auth rejections are worth another credential variant; rate
    // limits and server errors are transient states to skip quietly.
    if (resp.status !== 401 && resp.status !== 403) {
      throw new CursorSkipError(
        `Cursor usage export skipped (HTTP ${resp.status} ${resp.statusText}).`,
      );
    }
  }
  throw new CursorAuthError(
    `Cursor session rejected (${failures.join("; ")}). ` +
      `Open Cursor and sign in again, then re-run sync.`,
  );
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCount(value: string | undefined): number {
  if (value == null) return 0;
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function parseCost(value: string | undefined): number {
  if (value == null) return 0;
  const n = Number(value.replace(/[$,]/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

interface CsvRow {
  // An instant, or a day label when the export has no time of day
  date: Date | string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export function parseCursorCsv(text: string): CsvRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  const at = (name: string): number => header.indexOf(name);
  const dateIdx = at("Date");
  const modelIdx = at("Model");
  const withWriteIdx = at("Input (w/ Cache Write)");
  const withoutWriteIdx = at("Input (w/o Cache Write)");
  const cacheReadIdx = at("Cache Read");
  const outputIdx = at("Output Tokens");
  // Optional valuation columns; Cost is preferred (see header comment).
  const costIdx = at("Cost");
  const apiCostIdx = at("API Cost");
  const costToYouIdx = at("Cost to you");

  // An unrecognized header cannot establish complete usage; skip the run.
  const hasTokenColumn =
    withWriteIdx >= 0 ||
    withoutWriteIdx >= 0 ||
    cacheReadIdx >= 0 ||
    outputIdx >= 0;
  if (dateIdx < 0 || modelIdx < 0 || !hasTokenColumn) {
    throw new CursorSkipError(
      "Cursor export header unrecognized " +
        "(need Date, Model and at least one token column); skipping to " +
        `protect incremental state. Got: ${header.slice(0, 8).join(", ")}`,
    );
  }

  const parsed: CsvRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.length === 1 && (row[0] ?? "").trim() === "") continue;
    const rawDate = (row[dateIdx] ?? "").trim();
    const model = (row[modelIdx] ?? "").trim();
    if (!rawDate || !model) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date(rawDate);
    if (date instanceof Date && Number.isNaN(date.getTime())) continue;

    const withWrite = parseCount(row[withWriteIdx]);
    const withoutWrite = parseCount(row[withoutWriteIdx]);
    const inputTokens = withoutWriteIdx >= 0 ? withoutWrite : withWrite;
    const cacheCreationTokens =
      withWriteIdx >= 0 && withoutWriteIdx >= 0
        ? Math.max(0, withWrite - withoutWrite)
        : 0;
    const cacheReadTokens = parseCount(row[cacheReadIdx]);
    const outputTokens = parseCount(row[outputIdx]);
    let cost = 0;
    for (const idx of [costIdx, apiCostIdx, costToYouIdx]) {
      if (idx < 0) continue;
      const value = parseCost(row[idx]);
      if (value > 0) {
        cost = value;
        break;
      }
    }
    if (
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens ===
        0 &&
      cost === 0
    ) {
      continue;
    }
    parsed.push({
      date,
      model,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      cost,
    });
  }
  return parsed;
}

// Each row is one request: summed into its hour, or its day when the export
// has no time of day
export function aggregateCursorUsage(
  rows: CsvRow[],
  calendar: Calendar,
): UsageBucket[] {
  const buckets = new RequestBuckets(calendar);
  for (const { date, model, ...usage } of rows) {
    buckets.add(date, model, { ...usage, reasoningTokens: null });
  }
  return buckets.list();
}

export async function collectCursorUsage(
  calendar: Calendar,
): Promise<CursorUsageResult> {
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const timeoutMs = resolveCursorFetchTimeout(process.env.MYCCUSAGE_CURSOR_FETCH_TIMEOUT_MS);

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

  let csv: string;
  try {
    csv = await fetchUsageCsv(token, timeoutMs);
  } catch (error) {
    if (error instanceof CursorSkipError) {
      return emptyResult([error.message]);
    }
    throw error;
  }

  let rows: CsvRow[];
  try {
    rows = parseCursorCsv(csv);
  } catch (error) {
    if (error instanceof CursorSkipError) {
      return emptyResult([error.message]);
    }
    throw error;
  }
  if (rows.length === 0) {
    return emptyResult(["Cursor export contained no usage rows."]);
  }

  return {
    buckets: aggregateCursorUsage(rows, calendar),
    skipped: false,
    warnings: [],
  };
}
