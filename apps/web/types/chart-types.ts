// Shared types for chart components

import type { AgentType } from "./agent-types";

// The usage metrics every record, day and summary carries. Input excludes
// cache reads and writes; output includes reasoning.
export interface UsageMetrics {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// How cost splits, as collectors priced it. Zero where it was not recorded:
// day history, hours synced before collectors split cost, and cost an agent
// recorded without rates to split it by.
export interface CostSplit {
  // Parts of cost by token type
  inputCost: number;
  outputCost: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  // What cache reads saved over paying for them as uncached input
  cacheSavings: number;
  // Part of cost paid for a fast or ultrafast tier over standard
  speedPremium: number;
  // Tokens with no price, counted at zero cost
  unpricedTokens: number;
}

// One device's usage of one agent with one model on one day
export interface UsageRecord extends UsageMetrics, CostSplit {
  date: string;
  deviceId: string;
  agentType: AgentType;
  // "" for day history not attributed to a model
  model: string;
  // Part of output; null where the source does not report it
  reasoningTokens: number | null;
  // API requests; null where day history did not count them
  requests: number | null;
}

// One agent's usage in one hour of the account calendar, over all devices
// and models. Day history has no hours.
export interface HourlyRecord extends UsageMetrics {
  // ISO instant the hour starts
  hourStart: string;
  // Account-calendar day of the hour
  date: string;
  agentType: AgentType;
}

export interface Device {
  deviceId: string;
  deviceName: string;
  displayName: string | null;
}

// Series of a stacked chart: one point per day or hour, with a value for
// each series of the config
export interface SeriesChartData {
  chartData: Record<string, string | number>[];
  chartConfig: ChartConfig;
}

// Preset time ranges; "custom" is a range picked in the calendar
export type PresetRange = "all" | "1d" | "7d" | "14d" | "30d";
export type TimeRange = PresetRange | "custom";

export interface ChartConfig {
  [key: string]: {
    label: string;
    color: string;
  };
}

// What the dashboard measures usage in
export type UsageMetric = "cost" | "tokens";

// The unit of time charts and tables show
export type Resolution = "day" | "hour";

// What the trend chart stacks by
export type TrendGroup = "agent" | "device";
