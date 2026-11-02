import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { SYNC_PROTOCOL } from "@/lib/usage-sync";
import {
  createTestSchema,
  testDatabaseUrl as url,
  type TestSchema,
} from "./test-database";

let database: TestSchema | undefined;
let pool: Pool;
let post: typeof import("@/app/api/usage-sync/route").POST;

beforeAll(async () => {
  if (!url) return;
  database = await createTestSchema(url);
  pool = database.pool;
  vi.stubEnv("API_KEY", "integration-test-key");
  vi.stubEnv("USAGE_TIMEZONE", "UTC");
  vi.doMock("@/src/db", () => ({ db: drizzle(pool) }));
  post = (await import("@/app/api/usage-sync/route")).POST;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await database?.drop();
});

const bucket = (date: string, model: string, inputTokens: number) => ({
  date,
  model,
  inputTokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cost: 1,
  inputCost: 1,
  outputCost: 0,
  cacheCreationCost: 0,
  cacheReadCost: 0,
  cacheSavings: 0,
  speedPremium: 0,
  unpricedTokens: 0,
  hourStart: `${date}T10:00:00Z`,
  requests: 1,
});
async function upload(
  buckets: ReturnType<typeof bucket>[],
  backfillBefore?: string,
  deviceId = "device",
  agentType = "claude-code",
) {
  const response = await post(
    new NextRequest("http://localhost/api/usage-sync", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "integration-test-key",
      },
      body: JSON.stringify({
        version: SYNC_PROTOCOL,
        timezone: "UTC",
        device: { deviceId, deviceName: "test", agentType },
        buckets,
        backfillBefore,
      }),
    }),
  );
  expect(response.status).toBe(200);
  return response.json();
}

it.skipIf(!url)(
  "preserves whole old days, refreshes recent days, and serializes concurrent backfills",
  async () => {
    await upload([
      bucket("2024-01-01", "stored", 900),
      bucket("2026-10-01", "stored", 500),
    ]);
    await upload(
      [bucket("2024-01-02", "other-device", 700)],
      undefined,
      "other-device",
    );
    await upload(
      [bucket("2024-01-03", "other-agent", 800)],
      undefined,
      "device",
      "codex",
    );
    const incoming = [
      bucket("2024-01-01", "new-model", 10),
      bucket("2024-01-02", "new-model", 20),
      bucket("2024-01-02", "second-model", 30),
      bucket("2024-01-03", "new-model", 40),
      bucket("2026-10-01", "new-model", 50),
    ];
    const results = await Promise.all([
      upload(incoming, "2026-10-01"),
      upload(incoming, "2026-10-01"),
    ]);
    expect(results.map((r) => r.buckets).sort()).toEqual([1, 4]);
    const stored = await pool.query(
      `SELECT date::text, model, input_tokens::int FROM usage_buckets WHERE device_id = 'device' AND agent_type = 'claude-code' ORDER BY date, model`,
    );
    expect(stored.rows).toEqual([
      { date: "2024-01-01", model: "stored", input_tokens: 900 },
      { date: "2024-01-02", model: "new-model", input_tokens: 20 },
      { date: "2024-01-02", model: "second-model", input_tokens: 30 },
      { date: "2024-01-03", model: "new-model", input_tokens: 40 },
      { date: "2026-10-01", model: "new-model", input_tokens: 50 },
    ]);
    expect((await upload(incoming, "2026-10-01")).days).toEqual(["2026-10-01"]);
    // A normal refresh still replaces the whole day, as before.
    await upload([bucket("2026-10-01", "replacement", 60)]);
    expect(
      (
        await pool.query(
          `SELECT model FROM usage_buckets WHERE device_id = 'device' AND date = '2026-10-01'`,
        )
      ).rows,
    ).toEqual([{ model: "replacement" }]);
  },
);

it.skipIf(!url)(
  "keeps day history before the backfill boundary and replaces it from hours",
  async () => {
    const deviceId = "history-device";
    for (const date of ["2024-02-01", "2026-10-02"]) {
      await pool.query(
        `INSERT INTO usage_buckets (device_id, agent_type, date, model, input_tokens, total_tokens, cost)
         VALUES ($1, 'claude-code', $2, '', 900, 900, 9)`,
        [deviceId, date],
      );
    }
    await upload(
      [bucket("2024-02-01", "partial", 10), bucket("2026-10-02", "hours", 20)],
      "2026-10-01",
      deviceId,
    );
    const stored = await pool.query(
      `SELECT date::text, model, hour_start IS NULL AS whole_day, requests, input_cost::float8 AS input_cost
       FROM usage_buckets WHERE device_id = $1 ORDER BY date`,
      [deviceId],
    );
    // Day history keeps no cost split; uploaded hours carry theirs
    expect(stored.rows).toEqual([
      {
        date: "2024-02-01",
        model: "",
        whole_day: true,
        requests: null,
        input_cost: null,
      },
      {
        date: "2026-10-02",
        model: "hours",
        whole_day: false,
        requests: 1,
        input_cost: 1,
      },
    ]);
  },
);
