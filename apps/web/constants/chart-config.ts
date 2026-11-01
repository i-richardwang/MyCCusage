// Chart configuration constants
import type { PresetRange } from "@/types/chart-types";

export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
] as const;

export const AGENT_CHART_CONFIG = {
  "claude-code": {
    label: "Claude Code",
    color: "var(--chart-1)",
  },
  amp: {
    label: "AMP",
    color: "var(--chart-2)",
  },
  codex: {
    label: "Codex",
    color: "var(--chart-3)",
  },
  opencode: {
    label: "OpenCode",
    color: "var(--chart-4)",
  },
  dimagent: {
    label: "DimAgent",
    color: "var(--chart-5)",
  },
  cursor: {
    label: "Cursor",
    color: "var(--chart-6)",
  },
  antigravity: {
    label: "Antigravity",
    color: "var(--chart-7)",
  },
} as const;

// Length of each preset time range, which ends today
export const TIME_RANGE_DAYS = {
  "1d": 1,
  "7d": 7,
  "14d": 14,
  "30d": 30,
} as const satisfies Record<Exclude<PresetRange, "all">, number>;

// Longest range that can be shown hour by hour
export const HOURLY_RANGE_DAYS = 31;

// Longest range shown hour by hour until days are chosen
export const HOURLY_DEFAULT_DAYS = 2;

// A shade between the background and the foreground, so token types read as
// one quantity apart from the agent and device colors
const ink = (percent: number) =>
  `color-mix(in oklab, var(--foreground) ${percent}%, var(--background))`;

// Token types, in the order bars and legends show them
export const TOKEN_TYPE_CONFIG = {
  inputTokens: { label: "Input", color: ink(60) },
  cacheReadTokens: { label: "Cache read", color: ink(28) },
  cacheCreationTokens: { label: "Cache write", color: ink(78) },
  outputTokens: { label: "Output", color: ink(100) },
} as const;
