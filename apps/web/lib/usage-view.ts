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
  daysBetween,
  daysIn,
  hoursIn,
  lastDays,
  type DayRange,
} from "@/lib/day-range";
import type { UsageStatsResponse } from "@/types/api-types";
import type {
  CostSplit,
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

export interface HourUsage extends UsageMetrics {
  hourStart: string;
}

// Rates derived from usage metrics, defined once for the summary and models
export interface UsageRates {
  // Share of input tokens read from cache; cache writes count as misses.
  // Null without input.
  cacheHitRate: number | null;
  // Cost per million priced tokens; null without them
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

// The cost split of a selection, with how much of its cost and tokens it
// accounts for
export interface CostDetails extends CostSplit {
  // Share of cost split by token type; null without cost
  splitCoverage: number | null;
  // Share of tokens with no price; null without tokens
  unpricedShare: number | null;
}

export interface UsageSummary
  extends UsageMetrics,
    UsageRates,
    ReportedCounts,
    CostDetails {
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
    ReportedCounts,
    CostDetails {
  agentType: AgentType;
  // "" for day history not attributed to a model
  model: string;
}

// What tells one agent's model from another
export type ModelKey = Pick<ModelTotals, "agentType" | "model">;

// The hours of a range shown hour by hour, which load apart from its days
export type HoursLoad =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; records: HourlyRecord[] };

export interface HourlyView {
  // ISO instant every hour of the range starts
  hours: string[];
  status: HoursLoad["status"];
  // The selected hours; none until they are loaded
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

export type AccountUsage = Pick<UsageStatsResponse, "records" | "timezone">;

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

// Whether a range is short enough to show hour by hour
export function showsHours({ from, to }: DayRange): boolean {
  return from <= to && daysBetween(from, to) < HOURLY_RANGE_DAYS;
}

// Why hours shown at this resolution are missing; null where they are not
export function hoursNote(
  view: UsageView,
  resolution: Resolution,
): string | null {
  if (resolution !== "hour" || !view.hourly) return null;
  switch (view.hourly.status) {
    case "loading":
      return "Loading hours…";
    case "failed":
      return "Hours could not be loaded. Reload the page to try again.";
    case "loaded":
      return null;
  }
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

// The view of one agent, or all, over a range. `hours` are the range's
// hours, or null where it is too long to show them (see showsHours).
export function selectUsage(
  account: AccountUsage,
  agent: AgentType | "all",
  range: DayRange,
  hours: HoursLoad | null,
): UsageView {
  const selects = (record: { agentType: AgentType; date: string }) =>
    (agent === "all" || record.agentType === agent) &&
    contains(range, record.date);
  const selected = account.records.filter(selects);

  const daily = dailyUsage(selected, range);
  const hourly = hours
    ? {
        hours: hoursIn(range, account.timezone),
        status: hours.status,
        records: hours.status === "loaded" ? hours.records.filter(selects) : [],
      }
    : null;

  const summary = summarize(selected, daily);
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
export function modelDaily(view: UsageView, model: ModelKey): DailyUsage[] {
  return dailyUsage(view.records.filter(isModel(model)), view.range);
}

// Every hour of the view's range for one agent's model; none where the view
// has no hours
export function modelHourly(view: UsageView, model: ModelKey): HourUsage[] {
  if (!view.hourly) return [];
  const byHour = new Map<string, UsageMetrics>();
  for (const record of view.hourly.records.filter(isModel(model))) {
    byHour.set(
      record.hourStart,
      addUsage(byHour.get(record.hourStart) ?? NO_USAGE, record),
    );
  }
  return view.hourly.hours.map((hourStart) => ({
    hourStart,
    ...(byHour.get(hourStart) ?? NO_USAGE),
  }));
}

function isModel({ agentType, model }: ModelKey) {
  return (record: { agentType: AgentType; model: string }) =>
    record.agentType === agentType && record.model === model;
}

function rates(
  usage: UsageMetrics,
  { unpricedTokens }: Pick<CostSplit, "unpricedTokens">,
): UsageRates {
  const input =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return {
    cacheHitRate: input > 0 ? usage.cacheReadTokens / input : null,
    costPerMillionTokens:
      usage.totalTokens > unpricedTokens
        ? (usage.totalCost * 1_000_000) / (usage.totalTokens - unpricedTokens)
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

const NO_SPLIT: CostSplit = {
  inputCost: 0,
  outputCost: 0,
  cacheCreationCost: 0,
  cacheReadCost: 0,
  cacheSavings: 0,
  speedPremium: 0,
  unpricedTokens: 0,
};

function addSplit(a: CostSplit, b: CostSplit): CostSplit {
  return {
    inputCost: a.inputCost + b.inputCost,
    outputCost: a.outputCost + b.outputCost,
    cacheCreationCost: a.cacheCreationCost + b.cacheCreationCost,
    cacheReadCost: a.cacheReadCost + b.cacheReadCost,
    cacheSavings: a.cacheSavings + b.cacheSavings,
    speedPremium: a.speedPremium + b.speedPremium,
    unpricedTokens: a.unpricedTokens + b.unpricedTokens,
  };
}

function costDetails(split: CostSplit, usage: UsageMetrics): CostDetails {
  const parts =
    split.inputCost +
    split.outputCost +
    split.cacheCreationCost +
    split.cacheReadCost;
  return {
    ...split,
    // Rounding may carry the parts a little past their whole
    splitCoverage:
      usage.totalCost > 0 ? Math.min(parts / usage.totalCost, 1) : null,
    unpricedShare:
      usage.totalTokens > 0 ? split.unpricedTokens / usage.totalTokens : null,
  };
}

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
    {
      agentType: AgentType;
      model: string;
      usage: UsageMetrics;
      counts: ReportedCounts;
      split: CostSplit;
    }
  >();
  for (const record of records) {
    const key = `${record.agentType}\0${record.model}`;
    const totals = byModel.get(key);
    byModel.set(key, {
      agentType: record.agentType,
      model: record.model,
      usage: addUsage(totals?.usage ?? NO_USAGE, record),
      counts: addCounts(totals?.counts ?? NO_COUNTS, record),
      split: addSplit(totals?.split ?? NO_SPLIT, record),
    });
  }
  return [...byModel.values()]
    .filter(({ usage }) => isActive(usage))
    .map(({ agentType, model, usage, counts, split }) => ({
      agentType,
      model,
      ...usage,
      ...counts,
      ...costDetails(split, usage),
      ...shares(usage, total),
      ...rates(usage, split),
    }))
    .sort(byCostThenTokens);
}

function summarize(records: UsageRecord[], daily: DailyUsage[]): UsageSummary {
  const total = daily.reduce<UsageMetrics>(addUsage, NO_USAGE);
  const split = records.reduce<CostSplit>(addSplit, NO_SPLIT);
  const activeDays = daily.filter(isActive).length;
  return {
    ...total,
    ...rates(total, split),
    ...records.reduce<ReportedCounts>(addCounts, NO_COUNTS),
    ...costDetails(split, total),
    hourlyCoverage: ratio(
      records.reduce((sum, { hourlyTokens }) => sum + hourlyTokens, 0),
      total.totalTokens,
    ),
    activeDays,
    avgDailyCost: ratio(total.totalCost, activeDays),
  };
}
