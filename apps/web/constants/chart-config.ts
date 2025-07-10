// Chart configuration constants
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)", 
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)"
] as const

export const BASE_CHART_CONFIG = {
  cost: {
    label: "Cost",
    color: "var(--chart-1)"
  },
  tokens: {
    label: "Tokens",
    color: "var(--chart-2)"
  },
  inputTokens: {
    label: "Input Tokens",
    color: "var(--chart-1)"
  },
  outputTokens: {
    label: "Output Tokens",
    color: "var(--chart-2)"
  },
  cacheTokens: {
    label: "Cache Tokens",
    color: "var(--chart-3)"
  }
} as const

export const TIME_RANGE_DAYS = {
  "7d": 7,
  "14d": 14,
  "30d": 30
} as const