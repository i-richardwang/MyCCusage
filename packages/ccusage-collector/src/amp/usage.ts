import { RequestBuckets } from "../buckets.js";
import type { Calendar } from "../calendar.js";
import { estimateTokenCost, type PricingTable } from "../pricing/rates.js";
import type { UsageBucket } from "../types.js";
import { mergeDayUsage, stripProvider, type AmpModelUsage } from "./report.js";
import {
  dayReport,
  threadActiveDays,
  usageInstant,
  type AmpCachedThread,
  type AmpUsageEntry,
} from "./threads.js";

// Name models without their provider prefix ("meta/muse-spark" ->
// "muse-spark"), as report-based days do. Only Anthropic models have real
// cache writes; for the rest Amp reports inputTokens as 0 and puts uncached
// input under cacheCreationInputTokens (its own `amp usage` report shows it as
// uncached input), so move it back.
function normalizeEntry(entry: AmpUsageEntry): AmpUsageEntry {
  const model = stripProvider(entry.model);
  if (model.includes("claude")) return { ...entry, model };
  return {
    ...entry,
    model,
    inputTokens: entry.inputTokens + entry.cacheCreationTokens,
    cacheCreationTokens: 0,
  };
}

const TOKEN_COUNTERS = [
  "inputTokens",
  "outputTokens",
  "cacheCreationTokens",
  "cacheReadTokens",
] as const;
const COUNTERS = ["requests", ...TOKEN_COUNTERS] as const;

type Counters = Record<(typeof COUNTERS)[number], number>;

const zero = (): Counters => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

const tokenTotal = (entry: AmpUsageEntry) =>
  TOKEN_COUNTERS.reduce((sum, counter) => sum + entry[counter], 0);

// Integer shares of `total` in proportion to `weights`, summing to `total`
// exactly (largest remainders round up). All of it goes to the first share
// when nothing carries weight.
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((value, i) => [value - shares[i]!, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

// A main-agent request with its hour on the account's clocks
interface AgentRequest {
  hour: Date;
  entry: AmpUsageEntry;
}

interface ThreadDay {
  // Main agent + subagents from a reconciled report, else null
  merged: AmpModelUsage[] | null;
  // Main agent only, from the export
  requests: AgentRequest[];
  // Messages per hour of the day, the last resort for placing usage known
  // per day only
  activity: Map<string, number>;
}

export interface AmpUsage {
  buckets: UsageBucket[];
  // Models without usable prices; their tokens count at zero cost
  unpricedModels: string[];
}

interface AggregateOptions {
  calendar: Calendar;
  onUnreconciled?: (threadId: string, date: string) => void;
  pricing: PricingTable;
}

/**
 * Usage per hour and model across threads. The main agent's requests are
 * placed in their own hours. Subagent usage, which a day's report states per
 * model for the whole day, is spread over the thread's hours of that day in
 * proportion to the main agent's tokens there (the model's own first, then
 * any model's, then the thread's messages), so the day's totals are exact
 * and its hours an estimate. Days without a reconciled report (not fetched
 * yet, or not reconcilable) count the main agent only. Token usage is
 * resolved before base rates apply, so the main agent's export and report
 * are never valued twice.
 */
export function aggregateAmpUsage(
  threads: AmpCachedThread[],
  { calendar, onUnreconciled = () => {}, pricing }: AggregateOptions,
): AmpUsage {
  // Export and report name some models differently; learn the mapping from
  // reconciled days so the other days use the report names too.
  const aliases = new Map<string, string>();
  const threadDays: ThreadDay[] = [];

  for (const thread of threads) {
    const requestsByDay = new Map<string, AgentRequest[]>();
    for (const entry of thread.usage) {
      const instant = usageInstant(entry, thread.created);
      if (!instant) continue;
      const date = calendar.dayOf(instant);
      const requests = requestsByDay.get(date) ?? [];
      requests.push({
        hour: calendar.hourOf(instant),
        entry: normalizeEntry(entry),
      });
      requestsByDay.set(date, requests);
    }
    const activityByDay = new Map<string, Map<string, number>>();
    for (const timestamp of thread.activity) {
      const instant = new Date(timestamp);
      const date = calendar.dayOf(instant);
      const hours = activityByDay.get(date) ?? new Map<string, number>();
      const hour = calendar.hourOf(instant).toISOString();
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
      activityByDay.set(date, hours);
    }

    // Reports are fetched for active days, which include every usage day
    for (const date of threadActiveDays(thread, calendar)) {
      const requests = requestsByDay.get(date) ?? [];
      const reportEntry = dayReport(thread, date, calendar);
      const merged = reportEntry?.report
        ? mergeDayUsage(
            reportEntry.report,
            requests.map((request) => request.entry),
          )
        : null;
      if (merged) {
        for (const [from, to] of merged.aliases) aliases.set(from, to);
      } else if (reportEntry) {
        onUnreconciled(thread.id, date);
      }
      threadDays.push({
        merged: merged?.models ?? null,
        requests,
        activity: activityByDay.get(date) ?? new Map(),
      });
    }
  }

  const buckets = new RequestBuckets(calendar);
  for (const { merged, requests, activity } of threadDays) {
    const named = requests.map(({ hour, entry }) => ({
      hour: hour.toISOString(),
      model: aliases.get(entry.model) ?? entry.model,
      entry,
    }));
    const agent = new Map<string, Counters>();
    for (const { hour, model, entry } of named) {
      buckets.add(new Date(hour), model, {
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheCreationTokens: entry.cacheCreationTokens,
        cacheReadTokens: entry.cacheReadTokens,
        cost: 0,
        reasoningTokens: null,
      });
      const totals = agent.get(model) ?? zero();
      totals.requests += 1;
      for (const counter of TOKEN_COUNTERS) totals[counter] += entry[counter];
      agent.set(model, totals);
    }
    if (!merged) continue;

    // Hours weighted by the main agent's tokens there, in requests of the
    // given models
    const hoursOf = (models: (model: string) => boolean) => {
      const weights = new Map<string, number>();
      for (const { hour, model, entry } of named) {
        if (!models(model)) continue;
        weights.set(hour, (weights.get(hour) ?? 0) + tokenTotal(entry));
      }
      return weights;
    };

    // Whatever the report states beyond the main agent's requests belongs
    // to subagents
    for (const usage of merged) {
      const known = agent.get(usage.model) ?? zero();
      const remainder = zero();
      for (const counter of COUNTERS) {
        remainder[counter] = Math.max(usage[counter] - known[counter], 0);
      }
      if (COUNTERS.every((counter) => remainder[counter] === 0)) continue;

      let weights = hoursOf((model) => model === usage.model);
      if (weights.size === 0) weights = hoursOf(() => true);
      if (weights.size === 0) weights = activity;
      const hours = [...weights.keys()].sort();
      const shares = new Map(
        COUNTERS.map((counter) => [
          counter,
          apportion(
            remainder[counter],
            hours.map((hour) => weights.get(hour)!),
          ),
        ]),
      );
      hours.forEach((hour, i) => {
        const share = zero();
        for (const counter of COUNTERS)
          share[counter] = shares.get(counter)![i]!;
        if (COUNTERS.every((counter) => share[counter] === 0)) return;
        buckets.add(new Date(hour), usage.model, {
          ...share,
          cost: 0,
          reasoningTokens: null,
        });
      });
    }
  }

  const pricingAliases = new Map<string, string[]>();
  for (const [exportName, reportName] of aliases) {
    const names = pricingAliases.get(reportName) ?? [];
    names.push(exportName);
    pricingAliases.set(reportName, names);
  }
  const unpriced = new Set<string>();
  const priced = buckets.list().map((bucket) => {
    // Prefer routing names, then aliases established by reconciliation
    const estimate = estimateTokenCost(
      pricing,
      [bucket.model, ...(pricingAliases.get(bucket.model) ?? [])],
      bucket,
    );
    if (!estimate) unpriced.add(bucket.model);
    return { ...bucket, cost: estimate?.cost ?? 0 };
  });
  return { buckets: priced, unpricedModels: [...unpriced].sort() };
}
