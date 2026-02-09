// Shared types for chart components

// Agent type definitions
export type AgentType = 'claude-code' | 'amp' | 'codex'

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  'claude-code': 'Claude Code',
  'amp': 'AMP',
  'codex': 'Codex'
}

export interface DailyRecord {
  date: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  credits?: number
  agentType?: AgentType
  modelsUsed?: string[]
  createdAt?: Date
}

export interface DeviceRecord {
  date: string
  deviceId: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  credits?: number
  agentType?: AgentType
}

export interface AgentRecord {
  date: string
  agentType: AgentType
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  credits?: number
}

export interface Device {
  deviceId: string
  deviceName: string
  displayName?: string | null
  recordCount: number
  totalCost?: number
  lastActiveDate?: string
  agentTypes?: AgentType[]
  createdAt?: Date
  updatedAt?: Date
}

export interface MultiDeviceChartRecord {
  date: string
  [deviceId: string]: string | number
}

export interface ChartRecord {
  date: string
  cost: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheTokens: number
}

export interface RatioChartRecord {
  date: string
  ratio: number
  averageRatio: number
}

export interface RatioChartData {
  chartData: RatioChartRecord[]
  chartConfig: Record<string, { label: string; color: string }>
}

export type TimeRange = "all" | "7d" | "14d" | "30d" | "custom"

export interface ChartConfig {
  [key: string]: {
    label: string
    color: string
  }
}