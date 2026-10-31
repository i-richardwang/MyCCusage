/**
 * Shared API types - Single Source of Truth
 * Used by both API routes and frontend hooks
 */

import { Device, HourlyRecord, UsageRecord } from "./chart-types";
import { type AgentType } from "@/types/agent-types";

// Complete API response type: the account's usage at its stored grain, from
// which the dashboard derives every view
export interface UsageStatsResponse {
  // Account time zone; the dashboard's "today" is in it
  timezone: string;
  billingStartDate: string;
  devices: Device[];
  // Usage per day, device, agent and model
  records: UsageRecord[];
  // Usage per hour and agent, where sources report hours
  hourly: HourlyRecord[];
}

// Device of a usage upload, and the agent whose usage it carries
export interface UsageSyncDevice {
  deviceId: string;
  deviceName: string;
  displayName?: string;
  agentType: AgentType;
}

export interface UsageSyncResponse {
  success: boolean;
  // Days whose stored usage the upload replaced
  days: string[];
  // Buckets stored
  buckets: number;
}
