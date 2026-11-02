import { NextRequest, NextResponse } from "next/server";
import { and, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/src/db";
import { usageBuckets } from "@/src/db/schema";
import { type AgentType } from "@/types/agent-types";
import type { UsageHoursResponse } from "@/types/api-types";
import { isDay } from "@/lib/day-range";
import { metrics } from "@/lib/usage-query";
import { showsHours } from "@/lib/usage-view";

// The hours of the account days from `from` to `to`, a range short enough to
// show hour by hour
export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  if (!isDay(from) || !isDay(to) || !showsHours({ from, to })) {
    return NextResponse.json(
      { error: "from and to must be days of a range shown hour by hour" },
      { status: 400 },
    );
  }

  try {
    const rows = await db
      .select({
        // Day history is filtered out below, so every hour is known
        hourStart: sql<Date>`${usageBuckets.hourStart}`.mapWith(
          usageBuckets.hourStart,
        ),
        date: usageBuckets.date,
        deviceId: usageBuckets.deviceId,
        agentType: usageBuckets.agentType,
        model: usageBuckets.model,
        ...metrics,
      })
      .from(usageBuckets)
      .where(
        and(
          gte(usageBuckets.date, from),
          lte(usageBuckets.date, to),
          isNotNull(usageBuckets.hourStart),
        ),
      )
      .groupBy(
        usageBuckets.hourStart,
        usageBuckets.date,
        usageBuckets.deviceId,
        usageBuckets.agentType,
        usageBuckets.model,
      )
      .orderBy(usageBuckets.hourStart);

    const response: UsageHoursResponse = {
      hourly: rows.map(({ hourStart, ...record }) => ({
        ...record,
        hourStart: hourStart.toISOString(),
        agentType: record.agentType as AgentType,
      })),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching usage hours:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage hours" },
      { status: 500 },
    );
  }
}
