import type { DailyUsageRecord, UsageData } from "../types.js";
import { createAmpRunner, findAmpBinary, readAmpInstallationId } from "./cli.js";
import { aggregateAmpDaily } from "./daily.js";
import { loadCachedThreads, REPORTS_PER_HOUR, syncAmpCache } from "./sync.js";

// Amp keeps threads server-side, so ccusage has nothing local to read.
// Usage is collected through the user's authenticated `amp` CLI instead:
// thread exports give the main agent's usage per message, and per-day usage
// reports add subagents (see report.ts). Both are cached locally (sync.ts)
// and rebuilt into daily totals on every run, because the dashboard upserts
// whole days.
export async function collectAmpUsage(): Promise<
  Pick<UsageData, "daily" | "totals">
> {
  const binary = findAmpBinary();
  if (!binary) {
    throw new Error(
      "Amp CLI not found. Install it from https://ampcode.com and run `amp login`.",
    );
  }
  const installationId = readAmpInstallationId();
  if (!installationId) {
    throw new Error(
      "Amp installation id not found (~/.local/share/amp/device-id.json). Run `amp` once to initialize it.",
    );
  }

  console.log(`Collecting amp usage data via: ${binary} threads export/usage`);
  const result = await syncAmpCache(createAmpRunner(binary), installationId);
  console.log(
    `Amp threads: ${result.listed} listed, ${result.exported} exported, ${result.unchanged} unchanged` +
      (result.failed ? `, ${result.failed} failed` : "") +
      (result.deferred ? `, ${result.deferred} deferred to the next run` : ""),
  );
  console.log(
    `Amp usage reports: ${result.reportsFetched} fetched` +
      (result.reportsPending
        ? `, ${result.reportsPending} pending (up to ${REPORTS_PER_HOUR}/hour; those days count the main agent only until fetched)`
        : ""),
  );

  const unreconciled: string[] = [];
  const daily = aggregateAmpDaily(loadCachedThreads(), (threadId, date) =>
    unreconciled.push(`${threadId} ${date}`),
  );
  if (unreconciled.length > 0) {
    console.warn(
      `${unreconciled.length} Amp thread-day(s) could not be reconciled with their usage report and count the main agent only (first: ${unreconciled[0]})`,
    );
  }
  return { daily, totals: sumTotals(daily) };
}

function sumTotals(daily: DailyUsageRecord[]): UsageData["totals"] {
  const totals: UsageData["totals"] = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    totalTokens: 0,
    totalCost: 0,
  };
  for (const record of daily) {
    totals.inputTokens += record.inputTokens;
    totals.outputTokens += record.outputTokens;
    totals.cacheCreationTokens += record.cacheCreationTokens;
    totals.cacheReadTokens += record.cacheReadTokens;
    totals.totalTokens += record.totalTokens;
    totals.totalCost += record.totalCost;
  }
  return totals;
}
