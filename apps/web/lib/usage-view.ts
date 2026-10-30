/**
 * What the dashboard shows: the account's usage records narrowed to one agent
 * and one range of days, with every metric derived from them in one place.
 */

import { TIME_RANGE_DAYS } from "@/constants/chart-config";
import { contains, daysIn, lastDays, type DayRange } from "@/lib/day-range";
import type {
  AgentType,
  PresetRange,
  UsageMetrics,
  UsageRecord,
} from "@/types/chart-types";

// A preset, or a range picked in the calendar
export type Period = PresetRange | DayRange;

export interface DailyUsage extends UsageMetrics {
  date: string;
}

export interface UsageSummary extends UsageMetrics {
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

export interface UsageView {
  records: UsageRecord[];
  // Every day of the range; days without usage are zero
  daily: DailyUsage[];
  summary: UsageSummary;
}

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
  return usage.totalTokens > 0;
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
  records: UsageRecord[],
  agent: AgentType | "all",
  range: DayRange,
): UsageView {
  const selected = records.filter(
    (record) =>
      (agent === "all" || record.agentType === agent) &&
      contains(range, record.date),
  );

  const byDate = new Map<string, UsageMetrics>();
  for (const record of selected) {
    byDate.set(record.date, add(byDate.get(record.date) ?? NO_USAGE, record));
  }
  const daily = daysIn(range).map((date) => ({
    date,
    ...(byDate.get(date) ?? NO_USAGE),
  }));

  return { records: selected, daily, summary: summarize(daily) };
}

function summarize(daily: DailyUsage[]): UsageSummary {
  const total = daily.reduce<UsageMetrics>(add, NO_USAGE);
  const activeDays = daily.filter(isActive).length;
  return {
    ...total,
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
