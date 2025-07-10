// Shared types for chart components
export interface DailyRecord {
  date: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
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
}

export interface Device {
  deviceId: string
  deviceName: string
  recordCount: number
  totalCost?: number
  lastActiveDate?: string
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

export type TimeRange = "all" | "7d" | "14d" | "30d" | "custom"

export interface ChartConfig {
  [key: string]: {
    label: string
    color: string
  }
}