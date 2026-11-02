import { NextResponse } from "next/server";
import { db } from "@/src/db";
import { usageBuckets, devices } from "@/src/db/schema";
import { type AgentType } from "@/types/agent-types";
import type { UsageStatsResponse } from "@/types/api-types";
import { getAccountTimeZone } from "@/lib/account-timezone";
import {
  hourlyTokens,
  knownTotal,
  metrics,
  nullableTotal,
} from "@/lib/usage-query";

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

    const [deviceRows, recordRows] = await Promise.all([
      db
        .select({
          deviceId: devices.deviceId,
          deviceName: devices.deviceName,
          displayName: devices.displayName,
        })
        .from(devices),
      // Hours summed into their days, with day history; the dashboard derives
      // every daily view from these
      db
        .select({
          date: usageBuckets.date,
          deviceId: usageBuckets.deviceId,
          agentType: usageBuckets.agentType,
          model: usageBuckets.model,
          ...metrics,
          inputCost: knownTotal(usageBuckets.inputCost),
          outputCost: knownTotal(usageBuckets.outputCost),
          cacheCreationCost: knownTotal(usageBuckets.cacheCreationCost),
          cacheReadCost: knownTotal(usageBuckets.cacheReadCost),
          cacheSavings: knownTotal(usageBuckets.cacheSavings),
          speedPremium: knownTotal(usageBuckets.speedPremium),
          unpricedTokens: knownTotal(usageBuckets.unpricedTokens),
          reasoningTokens: nullableTotal(usageBuckets.reasoningTokens),
          requests: nullableTotal(usageBuckets.requests),
          hourlyTokens,
        })
        .from(usageBuckets)
        .groupBy(
          usageBuckets.date,
          usageBuckets.deviceId,
          usageBuckets.agentType,
          usageBuckets.model,
        )
        .orderBy(usageBuckets.date),
    ]);

    const response: UsageStatsResponse = {
      timezone: getAccountTimeZone(),
      billingStartDate,
      devices: deviceRows,
      records: recordRows.map((record) => ({
        ...record,
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
