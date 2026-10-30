import { NextResponse } from "next/server";
import { db } from "@/src/db";
import { usageRecords, devices } from "@/src/db/schema";
import type { AgentType } from "@/types/chart-types";
import type { UsageStatsResponse } from "@/types/api-types";
import { getAccountTimeZone } from "@/lib/account-timezone";

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
      db
        .select({
          date: usageRecords.date,
          deviceId: usageRecords.deviceId,
          agentType: usageRecords.agentType,
          totalCost: usageRecords.totalCost,
          totalTokens: usageRecords.totalTokens,
          inputTokens: usageRecords.inputTokens,
          outputTokens: usageRecords.outputTokens,
          cacheCreationTokens: usageRecords.cacheCreationTokens,
          cacheReadTokens: usageRecords.cacheReadTokens,
        })
        .from(usageRecords)
        .orderBy(usageRecords.date),
    ]);

    const response: UsageStatsResponse = {
      timezone: getAccountTimeZone(),
      billingStartDate,
      devices: deviceRows,
      records: recordRows.map((record) => ({
        ...record,
        agentType: record.agentType as AgentType,
        // numeric columns arrive as strings
        totalCost: Number(record.totalCost),
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
