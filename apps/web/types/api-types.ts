/**
 * Shared API types - Single Source of Truth
 * Used by both API routes and frontend hooks
 */

import { DailyRecord, DeviceRecord, Device } from './chart-types'

// Billing cycle information
export interface BillingCycleInfo {
  startDate: string
  endDate: string
  label: string
  startDateConfig: string
  daysRemaining: number
}

// Aggregated metrics (used for totals, currentCycle, previousCycle, last30Days)
export interface AggregatedMetrics {
  totalCost: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  activeDays: number
  avgDailyCost: number
}

// Alias for semantic clarity
export type Last30DaysMetrics = AggregatedMetrics

// Cumulative metrics for ROI calculations
export interface CumulativeData {
  totalCost: number
  totalTokens: number
  activeDays: number
  earliestDate: string | null
  latestDate: string | null
}

// Complete API response type
export interface UsageStatsResponse {
  billingCycle: BillingCycleInfo
  totals: AggregatedMetrics
  currentCycle: AggregatedMetrics
  previousCycle: AggregatedMetrics
  last30Days: Last30DaysMetrics
  cumulative: CumulativeData
  daily: DailyRecord[]
  devices: Device[]
  deviceData: DeviceRecord[]
}

// Usage sync request types
export interface UsageSyncDevice {
  deviceId: string
  deviceName: string
  displayName?: string
}

export interface UsageSyncRecord {
  date: string
  totalTokens: number
  totalCost: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  modelsUsed: string[]
}

export interface UsageSyncRequest {
  device: UsageSyncDevice
  daily: UsageSyncRecord[]
}

export interface UsageSyncResult {
  date: string
  status: 'success' | 'error'
  message?: string
}

export interface UsageSyncResponse {
  success: boolean
  processed: number
  results: UsageSyncResult[]
}
