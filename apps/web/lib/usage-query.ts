/**
 * Sums of usage_buckets columns for the dashboard's selects, as JSON numbers.
 */

import { sql } from "drizzle-orm";
import { usageBuckets } from "@/src/db/schema";

const total = (column: unknown) => sql<number>`sum(${column})::float8`;

export const nullableTotal = (column: unknown) =>
  sql<number | null>`sum(${column})::float8`;

// Buckets stored without a cost split count as none of it
export const knownTotal = (column: unknown) =>
  sql<number>`coalesce(sum(${column}), 0)::float8`;

// Tokens of the buckets recorded in hours rather than as day history
export const hourlyTokens = sql<number>`coalesce(sum(${usageBuckets.totalTokens}) filter (where ${usageBuckets.hourStart} is not null), 0)::float8`;

export const metrics = {
  totalCost: total(usageBuckets.cost),
  totalTokens: total(usageBuckets.totalTokens),
  inputTokens: total(usageBuckets.inputTokens),
  outputTokens: total(usageBuckets.outputTokens),
  cacheCreationTokens: total(usageBuckets.cacheCreationTokens),
  cacheReadTokens: total(usageBuckets.cacheReadTokens),
};
