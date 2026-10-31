// Service tier: "fast" is Claude fast mode or OpenAI's priority tier
export type RequestSpeed = "standard" | "fast" | "ultrafast";

// One billed API request read from an agent transcript. Input excludes cache
// reads and writes; reasoning is part of output.
export interface UsageRequest {
  timestampMs: number;
  model: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  // Part of cacheCreationTokens written with a one-hour lifetime
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  // Part of outputTokens; null when the agent does not report it
  reasoningTokens: number | null;
  // Cost the agent recorded itself, preferred over list prices
  reportedCost: number | null;
  speed: RequestSpeed;
  inferenceGeo?: string;
  // Requests repeated across lines or files share a key; null when the agent
  // writes each request once
  dedupeKey: string | null;
}

export function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

export function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
