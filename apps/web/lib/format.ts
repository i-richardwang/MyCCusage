/**
 * How the dashboard writes amounts and names what it measures. Every card,
 * chart and table goes through these, so one figure reads the same
 * everywhere.
 */

import type { UsageMetric, UsageMetrics } from "@/types/chart-types";

export function formatUsd(amount: number): string {
  const digits = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

// An amount that may be negative, always with its sign: +$1.00, -$1.00
export function formatSignedUsd(amount: number): string {
  return `${amount < 0 ? "-" : "+"}${formatUsd(Math.abs(amount))}`;
}

const TOKEN_UNITS = [
  { size: 1e9, suffix: "B" },
  { size: 1e6, suffix: "M" },
  { size: 1e3, suffix: "K" },
] as const;

// 1.2B, 34.5M, 6.7K, 890
export function formatTokens(tokens: number): string {
  for (const { size, suffix } of TOKEN_UNITS) {
    if (Math.abs(tokens) >= size) {
      const value = tokens / size;
      return `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}`;
    }
  }
  return Math.round(tokens).toLocaleString("en-US");
}

export function formatPercent(share: number): string {
  const percent = share * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${percent.toFixed(0)}%`;
}

export function formatCount(count: number): string {
  return count.toLocaleString("en-US");
}

// What each metric is called: as a title, and within a sentence
export const METRIC_NAMES: Record<
  UsageMetric,
  { title: string; noun: string }
> = {
  cost: { title: "Cost", noun: "cost" },
  tokens: { title: "Tokens", noun: "tokens" },
};

// The metric shown alongside the one the page measures
export function otherMetric(metric: UsageMetric): UsageMetric {
  return metric === "cost" ? "tokens" : "cost";
}

// The amount of usage a metric measures
export function metricValue(
  metric: UsageMetric,
  usage: Pick<UsageMetrics, "totalCost" | "totalTokens">,
): number {
  return metric === "cost" ? usage.totalCost : usage.totalTokens;
}

export function metricShare(
  metric: UsageMetric,
  shares: { costShare: number; tokenShare: number },
): number {
  return metric === "cost" ? shares.costShare : shares.tokenShare;
}

export function formatMetric(metric: UsageMetric, value: number): string {
  return metric === "cost" ? formatUsd(value) : formatTokens(value);
}

// Axis ticks: whole dollars where they suffice
export function formatAxisMetric(metric: UsageMetric, value: number): string {
  if (metric === "tokens") return formatTokens(value);
  return Math.abs(value) >= 1 || value === 0
    ? `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : formatUsd(value);
}
