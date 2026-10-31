import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";
import { queryRows } from "./sqlite.js";
import type { Calendar } from "./calendar.js";
import { RequestBuckets, type RequestTotals } from "./buckets.js";
import type { UsageBucket } from "./types.js";

// ---------------------------------------------------------------------------
// DimAgent usage parser
//
// Reads DimAgent's local SQLite store and reports usage per hour and model.
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
  // DimAgent's own home override (runtime-only lookup, not a build input).
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const explicitHome = process.env.DIMCODE_HOME?.trim();
  if (explicitHome) return join(resolve(explicitHome), "dimcode.sqlite");

  // XDG base directory support, same as the ccusage adapters.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const baseDir = xdgConfigHome
    ? resolve(xdgConfigHome, ".dimcode", "v2")
    : join(homedir(), ".dimcode", "v2");
  return join(baseDir, "dimcode.sqlite");
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

// --- Aggregation ------------------------------------------------------------

// One billed call, with its exact cost once its run has completed
interface Call {
  instant: Date;
  date: string;
  model: string;
  usage: RequestTotals;
  exactCost: number | null;
}

export function collectDimagentUsage(
  calendar: Calendar,
  dbPath: string = getDimAgentDbPath(),
): UsageBucket[] {
  if (!existsSync(dbPath)) return [];

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

  const calls: Call[] = [];
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

    const instant = new Date(row.createdAt);
    if (Number.isNaN(instant.getTime())) continue;

    const promptTokens = toCount(usage.promptTokens);
    const cacheReadTokens = toCount(usage.cacheReadTokens);
    const cacheCreationTokens = toCount(usage.cacheWriteTokens);
    const inputTokens = Math.max(0, promptTokens - cacheReadTokens);
    const outputTokens = toCount(usage.completionTokens);
    if (inputTokens + outputTokens + cacheReadTokens === 0) continue;

    const priced = row.runId ? runCost.get(row.runId) : undefined;
    calls.push({
      instant,
      date: calendar.dayOf(instant),
      model: row.modelId,
      usage: {
        inputTokens,
        outputTokens,
        cacheCreationTokens,
        cacheReadTokens,
        reasoningTokens: null,
        cost: 0,
      },
      // A run still in flight (or just finished) has no exact cost yet
      exactCost: priced && priced.cost > 0 ? priced.cost : null,
    });
  }

  // Calls without an exact cost are estimated at their model's exact rate on
  // the same day, so the day stays close to DimAgent's own estimate until the
  // next sync replaces it with the exact cost.
  const exact = new Map<string, { cost: number; tokens: number }>();
  for (const { date, model, usage, exactCost } of calls) {
    if (exactCost === null) continue;
    const key = `${date}\0${model}`;
    const sum = exact.get(key) ?? { cost: 0, tokens: 0 };
    sum.cost += exactCost;
    sum.tokens += usage.inputTokens + usage.outputTokens;
    exact.set(key, sum);
  }

  const buckets = new RequestBuckets(calendar);
  for (const { instant, date, model, usage, exactCost } of calls) {
    const rate = exact.get(`${date}\0${model}`);
    const cost =
      exactCost ??
      (rate && rate.tokens > 0
        ? ((usage.inputTokens + usage.outputTokens) * rate.cost) / rate.tokens
        : 0);
    buckets.add(instant, model, { ...usage, cost });
  }
  return buckets.list();
}
