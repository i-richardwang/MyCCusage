import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { UsageHoursResponse, UsageStatsResponse } from "@/types/api-types";
import {
  createTestSchema,
  testDatabaseUrl as url,
  type TestSchema,
} from "./test-database";

let database: TestSchema | undefined;
let pool: Pool;
let stats: typeof import("@/app/api/usage-stats/route").GET;
let hours: typeof import("@/app/api/usage-hours/route").GET;

beforeAll(async () => {
  if (!url) return;
  database = await createTestSchema(url);
  pool = database.pool;
  vi.stubEnv("USAGE_TIMEZONE", "UTC");
  vi.stubEnv("CLAUDE_BILLING_CYCLE_START_DATE", "2026-01-01");
  vi.doMock("@/src/db", () => ({ db: drizzle(pool) }));
  stats = (await import("@/app/api/usage-stats/route")).GET;
  hours = (await import("@/app/api/usage-hours/route")).GET;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.drop();
});

async function store(
  deviceId: string,
  date: string,
  hourStart: string | null,
  model: string,
  tokens: number,
) {
  await pool.query(
    `INSERT INTO usage_buckets (device_id, agent_type, date, hour_start, model, input_tokens, total_tokens, cost)
     VALUES ($1, 'claude-code', $2, $3, $4, $5, $5, 1)`,
    [deviceId, date, hourStart, model, tokens],
  );
}

const hoursOf = (query: string) =>
  hours(new NextRequest(`http://localhost/api/usage-hours?${query}`));

it.skipIf(!url)(
  "serves days with their hourly tokens, and hours per device and model by range",
  async () => {
    await store("work", "2026-10-01", null, "", 500);
    await store("work", "2026-10-30", "2026-10-30T10:00:00Z", "opus", 100);
    await store("work", "2026-10-30", "2026-10-30T10:00:00Z", "haiku", 20);
    await store("laptop", "2026-10-30", "2026-10-30T10:00:00Z", "opus", 300);
    await store("laptop", "2026-10-31", "2026-10-31T01:00:00Z", "opus", 7);

    const days: UsageStatsResponse = await (await stats()).json();
    expect(
      days.records.map(
        ({ date, deviceId, model, totalTokens, hourlyTokens }) => [
          date,
          deviceId,
          model,
          totalTokens,
          hourlyTokens,
        ],
      ),
    ).toEqual(
      expect.arrayContaining([
        ["2026-10-01", "work", "", 500, 0],
        ["2026-10-30", "work", "opus", 100, 100],
        ["2026-10-30", "laptop", "opus", 300, 300],
      ]),
    );
    expect(days).not.toHaveProperty("hourly");

    const response = await hoursOf("from=2026-10-30&to=2026-10-30");
    expect(response.status).toBe(200);
    const { hourly }: UsageHoursResponse = await response.json();
    expect(
      hourly
        .map(({ hourStart, deviceId, model, totalTokens }) => [
          hourStart,
          deviceId,
          model,
          totalTokens,
        ])
        .sort(),
    ).toEqual([
      ["2026-10-30T10:00:00.000Z", "laptop", "opus", 300],
      ["2026-10-30T10:00:00.000Z", "work", "haiku", 20],
      ["2026-10-30T10:00:00.000Z", "work", "opus", 100],
    ]);

    for (const query of [
      "from=2026-10-01&to=2026-11-01",
      "from=2026-10-31&to=2026-10-30",
      "from=2026-02-30&to=2026-03-01",
      "to=2026-10-30",
    ]) {
      expect((await hoursOf(query)).status).toBe(400);
    }
  },
);
