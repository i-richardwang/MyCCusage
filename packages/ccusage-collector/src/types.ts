// Agent types supported by the collector
export type AgentType = 'claude-code' | 'amp'

export interface DeviceInfo {
  deviceId: string
  deviceName: string
  displayName?: string
  agentType?: AgentType
}

export interface DailyUsageRecord {
  date: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  totalCost: number
  credits?: number  // AMP specific
  modelsUsed: string[]
  modelBreakdowns: Array<{
    modelName: string
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    cost: number
  }>
}

export interface UsageData {
  device: DeviceInfo
  daily: DailyUsageRecord[]
  totals: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    totalCost: number
    totalTokens: number
  }
}

export interface SyncResult {
  success: boolean
  processed: number
  results: Array<{
    date: string
    status: 'success' | 'error'
    message?: string
  }>
}

export interface CollectorConfig {
  endpoint: string
  apiKey: string
  displayName?: string
  agentType?: AgentType
  maxRetries?: number
  retryDelay?: number
}