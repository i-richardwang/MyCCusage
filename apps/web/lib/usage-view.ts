/**
 * What the dashboard shows: the account's usage records narrowed to one agent
 * and one range of days, with every metric derived from them in one place.
 */

import { HOURLY_RANGE_DAYS, TIME_RANGE_DAYS } from "@/constants/chart-config";
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
  UsageMetrics,
  UsageRecord,
} from "@/types/chart-types";
import { type AgentType } from "@/types/agent-types";

// A preset, or a range picked in the calendar
export type Period = PresetRange | DayRange;

export interface DailyUsage extends UsageMetrics {
  date: string;
}

export interface UsageSummary extends UsageMetrics {
  // Share of tokens whose hour is known
  hourlyCoverage: number;
  // Days with usage
  activeDays: number;
  // Per active day
  avgDailyCost: number;
  avgDailyTokens: number;
  // Share of the range's days with usage
  activityRate: number;
  // Share of cache tokens read rather than written
  cacheHitRate: number;
  costPerMillionTokens: number;
}

// One agent's use of one model over the range
export interface ModelTotals extends UsageMetrics {
  agentType: AgentType;
  // "" for usage its source did not attribute to a model
  model: string;
  // Over the records that count them; null when none does
  requests: number | null;
  // Part of output, over the records that report it; null when none does
  reasoningTokens: number | null;
  // Share of the range's cost
  costShare: number;
}

export interface HourlyView {
  // ISO instant every hour of the range starts
  hours: string[];
  records: HourlyRecord[];
}

export interface UsageView {
  records: UsageRecord[];
  // Every day of the range; days without usage are zero
  daily: DailyUsage[];
  // Models by cost, then tokens
  models: ModelTotals[];
  // Null when the range is too long to show hour by hour
  hourly: HourlyView | null;
  summary: UsageSummary;
}

export type AccountUsage = Pick<
  UsageStatsResponse,
  "records" | "hourly" | "timezone"
>;

const NO_USAGE: UsageMetrics = {
  totalCost: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

function add(a: UsageMetrics, b: UsageMetrics): UsageMetrics {
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

  const byDate = new Map<string, UsageMetrics>();
  for (const record of selected) {
    byDate.set(record.date, add(byDate.get(record.date) ?? NO_USAGE, record));
  }
  const daily = daysIn(range).map((date) => ({
    date,
    ...(byDate.get(date) ?? NO_USAGE),
  }));

  const hourly =
    daily.length <= HOURLY_RANGE_DAYS
      ? { hours: hoursIn(range, account.timezone), records: selectedHours }
      : null;

  const summary = summarize(daily, selectedHours);
  return {
    records: selected,
    daily,
    models: modelTotals(selected, summary),
    hourly,
    summary,
  };
}

// Sum of the counts known, or null when none is
function addKnown(a: number | null, b: number | null): number | null {
  return a === null ? b : b === null ? a : a + b;
}

function modelTotals(
  records: UsageRecord[],
  total: UsageMetrics,
): ModelTotals[] {
  const byModel = new Map<string, ModelTotals>();
  for (const record of records) {
    const key = `${record.agentType}\0${record.model}`;
    const totals = byModel.get(key);
    byModel.set(key, {
      agentType: record.agentType,
      model: record.model,
      ...add(totals ?? NO_USAGE, record),
      requests: addKnown(totals?.requests ?? null, record.requests),
      reasoningTokens: addKnown(
        totals?.reasoningTokens ?? null,
        record.reasoningTokens,
      ),
      costShare: 0,
    });
  }
  return [...byModel.values()]
    .filter(isActive)
    .map((totals) => ({
      ...totals,
      costShare: ratio(totals.totalCost, total.totalCost),
    }))
    .sort((a, b) => b.totalCost - a.totalCost || b.totalTokens - a.totalTokens);
}

function summarize(daily: DailyUsage[], hours: HourlyRecord[]): UsageSummary {
  const total = daily.reduce<UsageMetrics>(add, NO_USAGE);
  const activeDays = daily.filter(isActive).length;
  return {
    ...total,
    hourlyCoverage: ratio(
      hours.reduce((sum, { totalTokens }) => sum + totalTokens, 0),
      total.totalTokens,
    ),
    activeDays,
    avgDailyCost: ratio(total.totalCost, activeDays),
    avgDailyTokens: ratio(total.totalTokens, activeDays),
    activityRate: ratio(activeDays, daily.length),
    cacheHitRate: ratio(
      total.cacheReadTokens,
      total.cacheReadTokens + total.cacheCreationTokens,
    ),
    costPerMillionTokens: ratio(total.totalCost * 1_000_000, total.totalTokens),
  };
}
