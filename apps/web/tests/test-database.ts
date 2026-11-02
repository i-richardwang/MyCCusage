import { randomUUID } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

// Integration tests opt in with a disposable local PostgreSQL database. Each
// test file migrates its own schema; none touches application tables or reads
// DATABASE_URL.
export const testDatabaseUrl = process.env.MYCCUSAGE_TEST_DATABASE_URL;

export interface TestSchema {
  // Connections whose search path is the schema
  pool: Pool;
  drop: () => Promise<void>;
}

export async function createTestSchema(url: string): Promise<TestSchema> {
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname)) {
    throw new Error("Integration tests require a local disposable database");
  }
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({
    connectionString: url,
    options: `-c search_path=${schema}`,
  });
  const migrations = join(process.cwd(), "drizzle");
  for (const file of readdirSync(migrations)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await pool.query(readFileSync(join(migrations, file), "utf8"));
  }
  return {
    pool,
    drop: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}
