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

// A day of a day-level source, split by model in its breakdowns
export interface DailyUsageRecord {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  modelBreakdowns: ModelBreakdown[];
}

// Inclusive range of account-calendar days
export interface DayRange {
  from: string;
  to: string;
}

// One agent's usage of one model in one bucket of the account calendar: an
// hour when hourStart is set, otherwise a whole day
export interface UsageBucket {
  date: string;
  // ISO instant the hour starts
  hourStart?: string;
  // "" when the source does not attribute this usage to a model
  model: string;
  // Excludes cache reads and writes
  inputTokens: number;
  // Includes reasoning
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  // Part of outputTokens; absent when the source does not report it
  reasoningTokens?: number;
  cost: number;
  // API requests; absent when the source does not count them
  requests?: number;
}

// One upload: a device's usage of one agent
export interface UsageData {
  device: DeviceInfo;
  // IANA zone the buckets' days and hours were cut in; the dashboard rejects
  // any other zone than its own
  timezone: string;
  // Days the upload reports completely: their stored usage is replaced even
  // where the upload has no bucket. Without a range only the days of the
  // buckets are replaced.
  range?: DayRange;
  buckets: UsageBucket[];
}

export interface SyncResult {
  success: boolean;
  // Days whose stored usage the upload replaced
  days: string[];
  // Buckets stored
  buckets: number;
}

export interface CollectorConfig extends DeviceIdentity {
  endpoint: string;
  apiKey: string;
  agentTypes: AgentType[];
  maxRetries: number;
  retryDelay: number;
  /** Claude Code config directories to read; unset uses CLAUDE_CONFIG_DIR or the default directories. */
  claudeConfigDirs?: string[];
}
