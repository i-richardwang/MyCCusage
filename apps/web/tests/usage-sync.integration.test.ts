import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

// Opt in with a disposable local PostgreSQL database. Each run uses its own
// schema; it never touches application tables or reads DATABASE_URL.
const url = process.env.MYCCUSAGE_TEST_DATABASE_URL;
const schema = `backfill_${randomUUID().replaceAll("-", "")}`;
let admin: Pool;
let pool: Pool;
let post: typeof import("@/app/api/usage-sync/route").POST;

beforeAll(async () => {
  if (!url) return;
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("Integration tests require a local disposable database");
  }
  admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  const migrations = join(process.cwd(), "drizzle");
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pool.query(readFileSync(join(migrations, file), "utf8"));
  }
  vi.stubEnv("API_KEY", "integration-test-key");
  vi.stubEnv("USAGE_TIMEZONE", "UTC");
  vi.doMock("@/src/db", () => ({ db: drizzle(pool) }));
  post = (await import("@/app/api/usage-sync/route")).POST;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});

const bucket = (date: string, model: string, inputTokens: number) => ({
  date,
  model,
  inputTokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
  cost: 1,
  hourStart: `${date}T10:00:00Z`,
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
        version: 3,
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
