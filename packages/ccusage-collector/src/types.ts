import type { AgentType } from "./agents.js";
export type { AgentType } from "./agents.js";

export interface DeviceIdentity {
  deviceId: string;
  deviceName: string;
  displayName?: string;
}

export interface DeviceInfo extends DeviceIdentity {
  agentType: AgentType;
}

export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface DailyUsageRecord {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
  rawData?: Record<string, unknown>;
}

export interface UsageData {
  device: DeviceInfo;
  daily: DailyUsageRecord[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalCost: number;
    totalTokens: number;
  };
}

export interface SyncResult {
  success: boolean;
  processed: number;
  results: Array<{
    date: string;
    status: "success" | "error";
    message?: string;
  }>;
}

export interface CollectorConfig extends DeviceIdentity {
  endpoint: string;
  apiKey: string;
  agentTypes: AgentType[];
  maxRetries: number;
  retryDelay: number;
}
