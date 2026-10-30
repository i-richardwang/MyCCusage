// Shared types for chart components

// Agent type definitions
export type AgentType =
  | "claude-code"
  | "opencode"
  | "amp"
  | "codex"
  | "dimagent"
  | "cursor"
  | "antigravity";

// Ordered list of agents for UI display (tab order, etc.)
export const AGENT_TYPE_ORDER: AgentType[] = [
  "claude-code",
  "opencode",
  "amp",
  "codex",
  "dimagent",
  "cursor",
  "antigravity",
];

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  amp: "AMP",
  codex: "Codex",
  dimagent: "DimAgent",
  cursor: "Cursor",
  antigravity: "Antigravity",
};

// The usage metrics every record, day and summary carries
export interface UsageMetrics {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// One device's usage of one agent on one day, the grain usage is stored at
export interface UsageRecord extends UsageMetrics {
  date: string;
  deviceId: string;
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
