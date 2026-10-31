import { NextResponse } from "next/server";
import { isNotNull, sql } from "drizzle-orm";
import { db } from "@/src/db";
import { usageBuckets, devices } from "@/src/db/schema";
import { type AgentType } from "@/types/agent-types";
import type { UsageStatsResponse } from "@/types/api-types";
import { getAccountTimeZone } from "@/lib/account-timezone";

// Sums of bigint and numeric columns, as JSON numbers
const total = (column: unknown) => sql<number>`sum(${column})::float8`;
const nullableTotal = (column: unknown) =>
  sql<number | null>`sum(${column})::float8`;

const metrics = {
  totalCost: total(usageBuckets.cost),
  totalTokens: total(usageBuckets.totalTokens),
  inputTokens: total(usageBuckets.inputTokens),
  outputTokens: total(usageBuckets.outputTokens),
  cacheCreationTokens: total(usageBuckets.cacheCreationTokens),
  cacheReadTokens: total(usageBuckets.cacheReadTokens),
};

export async function GET() {
  try {
    // Get billing start date for cumulative/ROI calculations
    const billingStartDate = process.env.CLAUDE_BILLING_CYCLE_START_DATE;
    if (!billingStartDate) {
      return NextResponse.json(
        {
          error:
            "CLAUDE_BILLING_CYCLE_START_DATE environment variable is required",
        },
        { status: 500 },
      );
    }

    const [deviceRows, recordRows, hourlyRows] = await Promise.all([
      db
        .select({
          deviceId: devices.deviceId,
          deviceName: devices.deviceName,
          displayName: devices.displayName,
        })
        .from(devices),
      // Hours summed into their days; the dashboard derives every daily view
      // from these
      db
        .select({
          date: usageBuckets.date,
          deviceId: usageBuckets.deviceId,
          agentType: usageBuckets.agentType,
          model: usageBuckets.model,
          ...metrics,
          reasoningTokens: nullableTotal(usageBuckets.reasoningTokens),
          requests: nullableTotal(usageBuckets.requests),
        })
        .from(usageBuckets)
        .groupBy(
          usageBuckets.date,
          usageBuckets.deviceId,
          usageBuckets.agentType,
          usageBuckets.model,
        )
        .orderBy(usageBuckets.date),
      db
        .select({
          hourStart: usageBuckets.hourStart,
          date: usageBuckets.date,
          agentType: usageBuckets.agentType,
          ...metrics,
        })
        .from(usageBuckets)
        .where(isNotNull(usageBuckets.hourStart))
        .groupBy(
          usageBuckets.hourStart,
          usageBuckets.date,
          usageBuckets.agentType,
        )
        .orderBy(usageBuckets.hourStart),
    ]);

    const response: UsageStatsResponse = {
      timezone: getAccountTimeZone(),
      billingStartDate,
      devices: deviceRows,
      records: recordRows.map((record) => ({
        ...record,
        agentType: record.agentType as AgentType,
      })),
      hourly: hourlyRows.map(({ hourStart, ...record }) => ({
        ...record,
        hourStart: hourStart!.toISOString(),
        agentType: record.agentType as AgentType,
      })),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage statistics" },
      { status: 500 },
    );
  }
}
