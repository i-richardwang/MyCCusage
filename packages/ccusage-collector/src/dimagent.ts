import { execFileSync } from "child_process";
import { createRequire } from "module";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, join, resolve } from "path";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// DimAgent usage parser
//
// Reads DimAgent's local SQLite store and emits ccusage-compatible daily
// records, so the rest of the collector pipeline (mapCcusageRecord, sync)
// can stay untouched.
//
// Verified against real DimAgent data (~/.dimcode/v2/dimcode.sqlite):
// - usage_ledger holds one row per LLM call; `usage` is a JSON blob with
//   promptTokens / completionTokens / totalTokens / cacheReadTokens and an
//   optional cacheWriteTokens field.
// - Rows whose ledgerId starts with `plugin_ledger_` are non-billed plugin
//   overhead: the official usage_daily_stats table excludes them, so we do
//   too (they account for <0.1% of tokens and carry no cost).
// - Ledger rows forked from another session (ledgerId `ledger_<uuid>`) are
//   history copies; they are deduplicated by usage signature.
// - usage_ledger.cost is always NULL; exact cost lives in usage_run_stats
//   (per runId, JSON with totalCostUsd + full pricing). Ledger rows join
//   run stats on runId for exact cost.
// - Per-day SUM over usage_run_stats.cost matches the official
//   usage_daily_stats.estimatedCostUsd exactly, and ledger token sums match
//   the official daily token columns once plugin rows are excluded.
// ---------------------------------------------------------------------------

/** Ledger rows starting with this prefix are non-billed plugin overhead. */
const PLUGIN_LEDGER_PREFIX = "plugin_ledger_";

/** Forked-session history copies carry ledger ids shaped `ledger_<uuid>`. */
const FORKED_LEDGER_ID =
  /^ledger_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DimagentModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

/** A daily record using ccusage field names (see mapCcusageRecord). */
export interface DimagentDailyRecord {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  costUSD: number;
  modelsUsed: string[];
  modelBreakdowns: DimagentModelBreakdown[];
  rawData: Record<string, unknown>;
}

export interface DimagentUsageResult {
  daily: DimagentDailyRecord[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    totalCost: number;
  };
}

interface LedgerRow {
  ledgerId: string;
  runId: string | null;
  modelId: string;
  usage: string;
  createdAt: string;
}

interface RunCostRow {
  runId: string;
  modelId: string;
  cost: string | null;
}

export function getDimAgentDbPath(): string {
  // Test/fixture override (runtime-only lookup, not a build input)
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const override = process.env.MYCCUSAGE_DIMAGENT_DB?.trim();
  if (override) return resolve(override);

  // DimAgent home override (runtime-only lookup, not a build input)
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const explicitHome = process.env.DIMCODE_HOME?.trim();
  if (explicitHome) return join(resolve(explicitHome), "dimcode.sqlite");

  return join(homedir(), ".dimcode", "v2", "dimcode.sqlite");
}

function toCount(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

function usageSignature(row: {
  runId: string | null;
  modelId: string;
  usage: string;
  createdAt: string;
}): string {
  return [row.runId ?? "", row.modelId, row.usage, row.createdAt].join("\0");
}

function parseUsageJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseRunCost(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const total = (parsed as Record<string, unknown>).totalCostUsd;
      return typeof total === "number" && Number.isFinite(total) && total > 0
        ? total
        : 0;
    }
  } catch {
    // Malformed cost JSON: treated as unbilled below.
  }
  return 0;
}

// --- SQLite access ----------------------------------------------------------
// Zero-dependency like the collector: prefer Node's built-in node:sqlite
// (>= 22.5), fall back to the sqlite3 CLI. DimAgent keeps the DB in WAL
// mode and may hold a write lock while running, so on lock errors we query
// a disposable snapshot copy (db + -shm/-wal companions) instead.

type SqliteModule = {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => {
    prepare: (sql: string) => { all: () => Record<string, unknown>[] };
    close: () => void;
  };
};

let cachedSqlite: SqliteModule | null | undefined;

function getNodeSqlite(): SqliteModule | null {
  if (cachedSqlite !== undefined) return cachedSqlite;
  try {
    cachedSqlite = require("node:sqlite") as SqliteModule;
  } catch {
    cachedSqlite = null;
  }
  return cachedSqlite;
}

function isLockError(err: unknown): boolean {
  return (
    !!err &&
    typeof (err as { message?: unknown }).message === "string" &&
    /database is locked/i.test((err as { message: string }).message)
  );
}

function queryRows(dbPath: string, sql: string): Record<string, unknown>[] {
  const mod = getNodeSqlite();
  if (!mod) return queryRowsViaCli(dbPath, sql);
  const db = new mod.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } catch (err) {
    if (isLockError(err)) return querySnapshot(dbPath, sql);
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup failure; the query result (or throw) stands.
    }
  }
}

function queryRowsViaCli(dbPath: string, sql: string): Record<string, unknown>[] {
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024,
    });
    const trimmed = out.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as Record<string, unknown>[];
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") {
      throw new Error(
        "DimAgent sync needs SQLite access: install the sqlite3 CLI or use Node >= 22.5.",
      );
    }
    throw err;
  }
}

function querySnapshot(dbPath: string, sql: string): Record<string, unknown>[] {
  const snapshotDir = mkdtempSync(join(tmpdir(), "myccusage-dimagent-"));
  const queryPath = join(snapshotDir, basename(dbPath));
  try {
    copyFileSync(dbPath, queryPath);
    for (const suffix of ["-shm", "-wal"]) {
      const companion = `${dbPath}${suffix}`;
      if (existsSync(companion)) {
        copyFileSync(companion, `${queryPath}${suffix}`);
      }
    }
    const mod = getNodeSqlite();
    if (mod) {
      const db = new mod.DatabaseSync(queryPath, { readOnly: false });
      try {
        return db.prepare(sql).all();
      } finally {
        try {
          db.close();
        } catch {
          // Ignore cleanup failure on the disposable snapshot.
        }
      }
    }
    return queryRowsViaCli(queryPath, sql);
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}

// --- Aggregation ------------------------------------------------------------

interface DayModelAcc {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  exactCost: number;
  exactTokens: number;
  unbilledTokens: number;
}

function newAcc(): DayModelAcc {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    exactCost: 0,
    exactTokens: 0,
    unbilledTokens: 0,
  };
}

export function collectDimagentUsage(
  dbPath: string = getDimAgentDbPath(),
): DimagentUsageResult {
  if (!existsSync(dbPath)) {
    return {
      daily: [],
      totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        totalCost: 0,
      },
    };
  }

  const ledgerRows = queryRows(
    dbPath,
    `SELECT ledgerId, runId, modelId, usage, createdAt FROM usage_ledger`,
  ) as unknown as LedgerRow[];
  const runCostRows = queryRows(
    dbPath,
    `SELECT runId, modelId, cost FROM usage_run_stats`,
  ) as unknown as RunCostRow[];

  const runCost = new Map<string, { cost: number; modelId: string }>();
  for (const row of runCostRows) {
    if (!row.runId) continue;
    // usage_run_stats.runId is the primary key, so each run maps to one row.
    runCost.set(row.runId, {
      cost: parseRunCost(row.cost),
      modelId: row.modelId,
    });
  }

  // Deduplicate forked-session history copies. A fork row whose signature
  // matches a counted (non-fork, non-plugin) row is a copy: skip it. An
  // orphan fork row with no original is kept exactly once.
  const originalSignatures = new Set<string>();
  for (const row of ledgerRows) {
    if (!row.ledgerId || FORKED_LEDGER_ID.test(row.ledgerId)) continue;
    if (row.ledgerId.startsWith(PLUGIN_LEDGER_PREFIX)) continue;
    if (!parseUsageJson(row.usage)) continue;
    originalSignatures.add(usageSignature(row));
  }
  const keptOrphanClones = new Set<string>();

  const days = new Map<string, Map<string, DayModelAcc>>();

  for (const row of ledgerRows) {
    if (!row.ledgerId || row.ledgerId.startsWith(PLUGIN_LEDGER_PREFIX)) {
      continue;
    }
    if (FORKED_LEDGER_ID.test(row.ledgerId)) {
      const signature = usageSignature(row);
      if (
        originalSignatures.has(signature) ||
        keptOrphanClones.has(signature)
      ) {
        continue;
      }
      keptOrphanClones.add(signature);
    }

    const usage = parseUsageJson(row.usage);
    if (!usage) continue;

    const timestamp = new Date(row.createdAt);
    if (Number.isNaN(timestamp.getTime())) continue;
    // Group by calendar day in the collector's system timezone, matching
    // ccusage daily semantics (ccusage groups by JiffTimeZone::system
    // unless --timezone is given). toISOString() would group by UTC and
    // misattribute late-night usage to the previous day.
    const date =
      `${timestamp.getFullYear()}-` +
      `${String(timestamp.getMonth() + 1).padStart(2, "0")}-` +
      `${String(timestamp.getDate()).padStart(2, "0")}`;

    const promptTokens = toCount(usage.promptTokens);
    const cacheReadTokens = toCount(usage.cacheReadTokens);
    const cacheCreationTokens = toCount(usage.cacheWriteTokens);
    const inputTokens = Math.max(0, promptTokens - cacheReadTokens);
    const outputTokens = toCount(usage.completionTokens);
    if (inputTokens + outputTokens + cacheReadTokens === 0) continue;

    const model = row.modelId || "unknown";
    let models = days.get(date);
    if (!models) {
      models = new Map<string, DayModelAcc>();
      days.set(date, models);
    }
    let acc = models.get(model);
    if (!acc) {
      acc = newAcc();
      models.set(model, acc);
    }

    acc.inputTokens += inputTokens;
    acc.outputTokens += outputTokens;
    acc.cacheCreationTokens += cacheCreationTokens;
    acc.cacheReadTokens += cacheReadTokens;

    const priced = row.runId ? runCost.get(row.runId) : undefined;
    if (priced && priced.cost > 0) {
      acc.exactCost += priced.cost;
      acc.exactTokens += inputTokens + outputTokens;
    } else {
      // Run still in flight (or just finished): no exact cost yet. It is
      // estimated below from the model's priced average for the day; the
      // next sync upserts the exact value once the run completes.
      acc.unbilledTokens += inputTokens + outputTokens;
    }
  }

  const daily: DimagentDailyRecord[] = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, models]) => {
      let inputTokens = 0;
      let outputTokens = 0;
      let cacheCreationTokens = 0;
      let cacheReadTokens = 0;
      let costUSD = 0;

      const modelBreakdowns = [...models.entries()].map(
        ([modelName, acc]) => {
          let cost = acc.exactCost;
          if (acc.unbilledTokens > 0) {
            // Estimate unbilled tokens at the model's exact day rate so the
            // daily total stays close to the official estimate until the
            // exact run cost lands on the next sync.
            const rate =
              acc.exactTokens > 0 ? acc.exactCost / acc.exactTokens : 0;
            cost += acc.unbilledTokens * rate;
          }
          inputTokens += acc.inputTokens;
          outputTokens += acc.outputTokens;
          cacheCreationTokens += acc.cacheCreationTokens;
          cacheReadTokens += acc.cacheReadTokens;
          costUSD += cost;
          return {
            modelName,
            inputTokens: acc.inputTokens,
            outputTokens: acc.outputTokens,
            cacheCreationTokens: acc.cacheCreationTokens,
            cacheReadTokens: acc.cacheReadTokens,
            cost,
          };
        },
      );

      // ccusage sorts breakdowns by cost descending; modelsUsed follows.
      modelBreakdowns.sort((a, b) => b.cost - a.cost);
      const modelsUsed = modelBreakdowns.map((b) => b.modelName);

      // Same definition as ccusage UsageSummary::total_tokens().
      const totalTokens =
        inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens;
      return {
        date,
        inputTokens,
        outputTokens,
        cacheCreationInputTokens: cacheCreationTokens,
        cacheReadInputTokens: cacheReadTokens,
        totalTokens,
        costUSD,
        modelsUsed,
        modelBreakdowns,
        rawData: {
          source: "dimagent",
          date,
        },
      };
    });

  const totals = daily.reduce(
    (sum, record) => ({
      inputTokens: sum.inputTokens + record.inputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      cacheCreationTokens:
        sum.cacheCreationTokens + record.cacheCreationInputTokens,
      cacheReadTokens: sum.cacheReadTokens + record.cacheReadInputTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
      totalCost: sum.totalCost + record.costUSD,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      totalCost: 0,
    },
  );

  return { daily, totals };
}
