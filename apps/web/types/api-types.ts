/**
 * Shared API types - Single Source of Truth
 * Used by both API routes and frontend hooks
 */

import { AgentType, Device, UsageRecord } from "./chart-types";

// Complete API response type: the account's usage at its stored grain, from
// which the dashboard derives every view
export interface UsageStatsResponse {
  // Account time zone; the dashboard's "today" is in it
  timezone: string;
  billingStartDate: string;
  devices: Device[];
  records: UsageRecord[];
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
  rawData?: Record<string, unknown>;
}

export interface UsageSyncRequest {
  device: UsageSyncDevice;
  // IANA zone the daily dates were bucketed in; must be the account zone
  timezone: string;
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
