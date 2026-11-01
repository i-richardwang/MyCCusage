/**
 * What the dashboard shows: the account's usage records narrowed to one agent
 * and one range of days, with every metric derived from them in one place.
 */

import {
  HOURLY_DEFAULT_DAYS,
  HOURLY_RANGE_DAYS,
  TIME_RANGE_DAYS,
} from "@/constants/chart-config";
import {
  contains,
  daysIn,
  hoursIn,
  lastDays,
  type DayRange,
} from "@/lib/day-range";
import type { UsageStatsResponse } from "@/types/api-types";
import type {
  HourlyRecord,
  PresetRange,
  Resolution,
  UsageMetric,
  UsageMetrics,
  UsageRecord,
} from "@/types/chart-types";
import { type AgentType } from "@/types/agent-types";

// A preset, or a range picked in the calendar
export type Period = PresetRange | DayRange;

export interface DailyUsage extends UsageMetrics {
  date: string;
}

// Rates derived from usage metrics, defined once for the summary and models
export interface UsageRates {
  // Share of input tokens read from cache; cache writes count as misses.
  // Null without input.
  cacheHitRate: number | null;
  // Cost per million tokens; null without tokens
  costPerMillionTokens: number | null;
}

// Share of the selection's cost and tokens
export interface UsageShares {
  costShare: number;
  tokenShare: number;
}

// Counts not every record carries: day history may lack requests, and some
// sources do not report reasoning. Null when no selected record does
export interface ReportedCounts {
  // API requests
  requests: number | null;
  // Part of output
  reasoningTokens: number | null;
}

export interface UsageSummary extends UsageMetrics, UsageRates, ReportedCounts {
  // Share of tokens whose hour is known
  hourlyCoverage: number;
  // Days with usage
  activeDays: number;
  // Cost per active day
  avgDailyCost: number;
}

export interface AgentTotals extends UsageMetrics, UsageShares {
  agentType: AgentType;
}

export interface DeviceTotals extends UsageMetrics, UsageShares {
  deviceId: string;
}

// One agent's use of one model over the range
export interface ModelTotals
  extends UsageMetrics,
    UsageShares,
    UsageRates,
    ReportedCounts {
  agentType: AgentType;
  // "" for day history not attributed to a model
  model: string;
}

export interface HourlyView {
  // ISO instant every hour of the range starts
  hours: string[];
  records: HourlyRecord[];
}

export interface UsageView {
  range: DayRange;
  records: UsageRecord[];
  // Every day of the range; days without usage are zero
  daily: DailyUsage[];
  // Agents, devices and models with usage, by cost, then tokens
  agents: AgentTotals[];
  devices: DeviceTotals[];
  models: ModelTotals[];
  // Null when the range is too long to show hour by hour
  hourly: HourlyView | null;
  summary: UsageSummary;
}

export type AccountUsage = Pick<
  UsageStatsResponse,
  "records" | "hourly" | "timezone"
>;

export const NO_USAGE: UsageMetrics = {
  totalCost: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

export function addUsage(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
  return {
    totalCost: a.totalCost + b.totalCost,
    totalTokens: a.totalTokens + b.totalTokens,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  };
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function isActive(usage: UsageMetrics): boolean {
  return usage.totalTokens > 0 || usage.totalCost > 0;
}

// Presets end today; all time starts on the account's first recorded day
export function periodRange(
  period: Period,
  today: string,
  records: UsageRecord[],
): DayRange {
  if (typeof period !== "string") return period;
  if (period === "all") {
    const from = records.reduce(
      (first, { date }) => (date < first ? date : first),
      today,
    );
    return { from, to: today };
  }
  return lastDays(today, TIME_RANGE_DAYS[period]);
}

// Hours where the range has them and they are chosen, or the range is short
// enough to show them by default; days otherwise
export function viewResolution(
  view: UsageView,
  chosen: Resolution | null,
): Resolution {
  if (!view.hourly) return "day";
  return chosen ?? (view.daily.length <= HOURLY_DEFAULT_DAYS ? "hour" : "day");
}

export function selectUsage(
  account: AccountUsage,
  agent: AgentType | "all",
  range: DayRange,
): UsageView {
  const selects = (record: { agentType: AgentType; date: string }) =>
    (agent === "all" || record.agentType === agent) &&
    contains(range, record.date);
  const selected = account.records.filter(selects);
  const selectedHours = account.hourly.filter(selects);

  const daily = dailyUsage(selected, range);
  const hourly =
    daily.length <= HOURLY_RANGE_DAYS
      ? { hours: hoursIn(range, account.timezone), records: selectedHours }
      : null;

  const summary = summarize(selected, daily, selectedHours);
  return {
    range,
    records: selected,
    daily,
    agents: totalsBy(selected, summary, (record) => record.agentType).map(
      ({ key, ...totals }) => ({ agentType: key, ...totals }),
    ),
    devices: totalsBy(selected, summary, (record) => record.deviceId).map(
      ({ key, ...totals }) => ({ deviceId: key, ...totals }),
    ),
    models: modelTotals(selected, summary),
    hourly,
    summary,
  };
}

// Every day of the range, summing the records on it
function dailyUsage(
  records: UsageRecord[],
  range: DayRange,
): DailyUsage[] {
  const byDate = new Map<string, UsageMetrics>();
  for (const record of records) {
    byDate.set(record.date, addUsage(byDate.get(record.date) ?? NO_USAGE, record));
  }
  return daysIn(range).map((date) => ({
    date,
    ...(byDate.get(date) ?? NO_USAGE),
  }));
}

// Every day of the view's range for one agent's model
export function modelDaily(
  view: UsageView,
  { agentType, model }: Pick<ModelTotals, "agentType" | "model">,
): DailyUsage[] {
  return dailyUsage(
    view.records.filter(
      (record) => record.agentType === agentType && record.model === model,
    ),
    view.range,
  );
}

function rates(usage: UsageMetrics): UsageRates {
  const input =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return {
    cacheHitRate: input > 0 ? usage.cacheReadTokens / input : null,
    costPerMillionTokens:
      usage.totalTokens > 0
        ? (usage.totalCost * 1_000_000) / usage.totalTokens
        : null,
  };
}

function shares(usage: UsageMetrics, total: UsageMetrics): UsageShares {
  return {
    costShare: ratio(usage.totalCost, total.totalCost),
    tokenShare: ratio(usage.totalTokens, total.totalTokens),
  };
}

// Sum of the counts known, or null when none is
function addKnown(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : a + b;
}

function addCounts(a: ReportedCounts, b: ReportedCounts): ReportedCounts {
  return {
    requests: addKnown(a.requests, b.requests),
    reasoningTokens: addKnown(a.reasoningTokens, b.reasoningTokens),
  };
}

const NO_COUNTS: ReportedCounts = { requests: null, reasoningTokens: null };

// Largest usage first by one metric, then by the other
export function byMetric(
  metric: UsageMetric,
): (a: UsageMetrics, b: UsageMetrics) => number {
  return metric === "cost"
    ? (a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens
    : (a, b) => b.totalTokens - a.totalTokens || b.totalCost - a.totalCost;
}

const byCostThenTokens = byMetric("cost");

function totalsBy<K extends string>(
  records: UsageRecord[],
  total: UsageMetrics,
  key: (record: UsageRecord) => K,
): (UsageMetrics & UsageShares & { key: K })[] {
  const byKey = new Map<K, UsageMetrics>();
  for (const record of records) {
    const k = key(record);
    byKey.set(k, addUsage(byKey.get(k) ?? NO_USAGE, record));
  }
  return [...byKey]
    .map(([k, usage]) => ({ key: k, ...usage, ...shares(usage, total) }))
    .filter(isActive)
    .sort(byCostThenTokens);
}

function modelTotals(
  records: UsageRecord[],
  total: UsageMetrics,
): ModelTotals[] {
  const byModel = new Map<
    string,
    { agentType: AgentType; model: string; usage: UsageMetrics; counts: ReportedCounts }
  >();
  for (const record of records) {
    const key = `${record.agentType}\0${record.model}`;
    const totals = byModel.get(key);
    byModel.set(key, {
      agentType: record.agentType,
      model: record.model,
      usage: addUsage(totals?.usage ?? NO_USAGE, record),
      counts: addCounts(totals?.counts ?? NO_COUNTS, record),
    });
  }
  return [...byModel.values()]
    .filter(({ usage }) => isActive(usage))
    .map(({ agentType, model, usage, counts }) => ({
      agentType,
      model,
      ...usage,
      ...counts,
      ...shares(usage, total),
      ...rates(usage),
    }))
    .sort(byCostThenTokens);
}

function summarize(
  records: UsageRecord[],
  daily: DailyUsage[],
  hours: HourlyRecord[],
): UsageSummary {
  const total = daily.reduce<UsageMetrics>(addUsage, NO_USAGE);
  const activeDays = daily.filter(isActive).length;
  return {
    ...total,
    ...rates(total),
    ...records.reduce<ReportedCounts>(addCounts, NO_COUNTS),
    hourlyCoverage: ratio(
      hours.reduce((sum, { totalTokens }) => sum + totalTokens, 0),
      total.totalTokens,
    ),
    activeDays,
    avgDailyCost: ratio(total.totalCost, activeDays),
  };
}
