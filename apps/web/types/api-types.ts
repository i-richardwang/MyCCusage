/**
 * Shared API types - Single Source of Truth
 * Used by both API routes and frontend hooks
 */

import {
  DailyRecord,
  DeviceRecord,
  Device,
  AgentType,
  AgentRecord,
} from "./chart-types";

// Aggregated metrics (used for totals, last30Days)
export interface AggregatedMetrics {
  totalCost: number;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCredits?: number;
  activeDays: number;
  avgDailyCost: number;
}

// Alias for semantic clarity
export type Last30DaysMetrics = AggregatedMetrics;

// Complete API response type
export interface UsageStatsResponse {
  totals: AggregatedMetrics;
  last30Days: Last30DaysMetrics;
  billingStartDate: string;
  daily: DailyRecord[];
  devices: Device[];
  deviceData: DeviceRecord[];
  agentData?: AgentRecord[];
}

// Usage sync request types
export interface UsageSyncDevice {
  deviceId: string;
  deviceName: string;
  displayName?: string;
  agentType?: AgentType;
}

export interface UsageSyncRecord {
  date: string;
  totalTokens: number;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  credits?: number;
  modelsUsed: string[];
}

export interface UsageSyncRequest {
  device: UsageSyncDevice;
  daily: UsageSyncRecord[];
}

export interface UsageSyncResult {
  date: string;
  status: "success" | "error";
  message?: string;
}

export interface UsageSyncResponse {
  success: boolean;
  processed: number;
  results: UsageSyncResult[];
}
