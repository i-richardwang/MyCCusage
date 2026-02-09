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
  }
} as const

export const INPUT_OUTPUT_RATIO_CHART_CONFIG = {
  ratio: {
    label: "Input/Output Ratio",
    color: "var(--chart-1)"
  },
  averageRatio: {
    label: "Average Ratio",
    color: "var(--chart-2)"
  }
} as const

// Agent type colors and configuration
export const AGENT_COLORS = {
  'claude-code': 'var(--chart-1)',
  'amp': 'var(--chart-2)',
  'codex': 'var(--chart-3)',
} as const

export const AGENT_CHART_CONFIG = {
  'claude-code': {
    label: 'Claude Code',
    color: 'var(--chart-1)'
  },
  'amp': {
    label: 'AMP',
    color: 'var(--chart-2)'
  },
  'codex': {
    label: 'Codex',
    color: 'var(--chart-3)'
  }
} as const

export const TIME_RANGE_DAYS = {
  "all": Infinity,
  "7d": 7,
  "14d": 14,
  "30d": 30,
  "custom": 0 // Custom range handled separately
} as const