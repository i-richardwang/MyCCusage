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

// One device's usage of one agent with one model on one day
export interface UsageRecord extends UsageMetrics {
  date: string;
  deviceId: string;
  agentType: AgentType;
  // "" for usage its source did not attribute to a model
  model: string;
  // Part of output; null where the source does not report it
  reasoningTokens: number | null;
  // API requests; null where the source does not count them
  requests: number | null;
}

// One agent's usage in one hour of the account calendar, over all devices
// and models. Only sources that record request times report hours.
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

export interface RatioChartRecord {
  date: string;
  ratio: number;
  averageRatio: number;
}

export interface RatioChartData {
  chartData: RatioChartRecord[];
  chartConfig: Record<string, { label: string; color: string }>;
}

export interface HourlyChartData {
  chartData: Record<string, string | number>[];
  chartConfig: ChartConfig;
  activeAgents: AgentType[];
}

// Preset time ranges; "custom" is a range picked in the calendar
export type PresetRange = "all" | "7d" | "14d" | "30d";
export type TimeRange = PresetRange | "custom";

export interface ChartConfig {
  [key: string]: {
    label: string;
    color: string;
  };
}

// Pie chart data types
export interface PieChartRecord {
  name: string;
  value: number;
  fill: string;
}

export interface PieChartData {
  chartData: PieChartRecord[];
  chartConfig: ChartConfig;
  total: number;
}
