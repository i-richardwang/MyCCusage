import { execFileSync } from "child_process";
import { createRequire } from "module";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

const require = createRequire(import.meta.url);

// --- SQLite access ----------------------------------------------------------
// Zero-dependency: prefer Node's built-in node:sqlite (>= 22.5), fall back
// to the sqlite3 CLI. Agent stores may live in WAL mode with a writer
// holding a lock, so on lock errors we query a disposable snapshot copy
// (db + -shm/-wal companions) instead.

type SqliteModule = {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => {
    prepare: (sql: string) => { all: () => Record<string, unknown>[] };
    close: () => void;
  };
};

let cachedSqlite: SqliteModule | null | undefined;

function getNodeSqlite(): SqliteModule | null {
  if (cachedSqlite !== undefined) return cachedSqlite;
  try {
    cachedSqlite = require("node:sqlite") as SqliteModule;
  } catch {
    cachedSqlite = null;
  }
  return cachedSqlite;
}

function isLockError(err: unknown): boolean {
  return (
    !!err &&
    typeof (err as { message?: unknown }).message === "string" &&
    /database is locked/i.test((err as { message: string }).message)
  );
}

export function queryRows(
  dbPath: string,
  sql: string,
): Record<string, unknown>[] {
  const mod = getNodeSqlite();
  if (!mod) return queryRowsViaCli(dbPath, sql);
  const db = new mod.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } catch (err) {
    if (isLockError(err)) return querySnapshot(dbPath, sql);
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup failure; the query result (or throw) stands.
    }
  }
}

function queryRowsViaCli(
  dbPath: string,
  sql: string,
): Record<string, unknown>[] {
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024,
    });
    const trimmed = out.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as Record<string, unknown>[];
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") {
      throw new Error(
        "SQLite access needs the sqlite3 CLI or Node >= 22.5.",
      );
    }
    throw err;
  }
}

function querySnapshot(
  dbPath: string,
  sql: string,
): Record<string, unknown>[] {
  const snapshotDir = mkdtempSync(join(tmpdir(), "myccusage-sqlite-"));
  const queryPath = join(snapshotDir, basename(dbPath));
  try {
    copyFileSync(dbPath, queryPath);
    for (const suffix of ["-shm", "-wal"]) {
      const companion = `${dbPath}${suffix}`;
      if (existsSync(companion)) {
        copyFileSync(companion, `${queryPath}${suffix}`);
      }
    }
    const mod = getNodeSqlite();
    if (mod) {
      const db = new mod.DatabaseSync(queryPath, { readOnly: false });
      try {
        return db.prepare(sql).all();
      } finally {
        try {
          db.close();
        } catch {
          // Ignore cleanup failure on the disposable snapshot.
        }
      }
    }
    return queryRowsViaCli(queryPath, sql);
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}
