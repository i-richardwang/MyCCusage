// Agent types supported by the collector
export type AgentType =
  | "claude-code"
  | "amp"
  | "opencode"
  | "codex"
  | "dimagent"
  | "cursor"
  | "antigravity";

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  displayName?: string;
  agentType?: AgentType;
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

export interface CollectorConfig {
  endpoint: string;
  apiKey: string;
  displayName?: string;
  agentTypes?: AgentType[];
  maxRetries?: number;
  retryDelay?: number;
}
