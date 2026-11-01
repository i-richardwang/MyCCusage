import { execFileSync } from "child_process";
import { createRequire } from "module";
import { copyFileSync, existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

const require = createRequire(import.meta.url);

// --- SQLite access ----------------------------------------------------------
// Zero-dependency: prefer Node's built-in node:sqlite (>= 22.5), fall back
// to the sqlite3 CLI. Agent stores may live in WAL mode with a writer
// holding a lock, so on lock errors the whole read runs again against a
// disposable snapshot copy (db + -shm/-wal companions).
//
// Select BLOB columns as hex(column): the CLI's JSON output cannot carry raw
// bytes. Decode them with `hexBytes`.

export type Row = Record<string, unknown>;

// Runs one SQL statement against the open database
export type Query = (sql: string) => Row[];

type SqliteModule = {
  DatabaseSync: new (
    path: string,
    options?: { readOnly?: boolean },
  ) => {
    prepare: (sql: string) => { all: () => Row[] };
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

/**
 * Opens the database read-only and runs `read` with a query function. A lock
 * held by a live writer makes `read` run again, from the start, against a
 * snapshot copy, so it must not keep state outside its return value.
 */
export function withDatabase<T>(dbPath: string, read: (query: Query) => T): T {
  const mod = getNodeSqlite();
  if (!mod) return read((sql) => queryRowsViaCli(dbPath, sql));
  const db = new mod.DatabaseSync(dbPath, { readOnly: true });
  try {
    return read((sql) => db.prepare(sql).all());
  } catch (err) {
    if (isLockError(err)) return readSnapshot(dbPath, read);
    throw err;
  } finally {
    try {
      db.close();
    } catch {
      // Ignore cleanup failure; the result (or throw) stands.
    }
  }
}

export function queryRows(dbPath: string, sql: string): Row[] {
  return withDatabase(dbPath, (query) => query(sql));
}

// Bytes of a hex(column) value; null when the column is NULL or empty, which
// SQLite both render as ""
export function hexBytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^(?:[0-9A-Fa-f]{2})*$/.test(value)) {
    throw new Error("Expected a hex-encoded BLOB");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function queryRowsViaCli(dbPath: string, sql: string): Row[] {
  try {
    const out = execFileSync("sqlite3", ["-json", dbPath, sql], {
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 100 * 1024 * 1024,
    });
    const trimmed = out.trim();
    if (!trimmed || trimmed === "[]") return [];
    return JSON.parse(trimmed) as Row[];
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === "ENOENT") {
      throw new Error("SQLite access needs the sqlite3 CLI or Node >= 22.5.");
    }
    throw err;
  }
}

function readSnapshot<T>(dbPath: string, read: (query: Query) => T): T {
  const snapshotDir = mkdtempSync(join(tmpdir(), "myccusage-sqlite-"));
  const snapshotPath = join(snapshotDir, basename(dbPath));
  try {
    copyFileSync(dbPath, snapshotPath);
    for (const suffix of ["-shm", "-wal"]) {
      const companion = `${dbPath}${suffix}`;
      if (existsSync(companion)) {
        copyFileSync(companion, `${snapshotPath}${suffix}`);
      }
    }
    const mod = getNodeSqlite();
    if (!mod) return read((sql) => queryRowsViaCli(snapshotPath, sql));
    // Writable: recovering the copied WAL needs to write the -shm index
    const db = new mod.DatabaseSync(snapshotPath, { readOnly: false });
    try {
      return read((sql) => db.prepare(sql).all());
    } finally {
      try {
        db.close();
      } catch {
        // Ignore cleanup failure on the disposable snapshot.
      }
    }
  } finally {
    rmSync(snapshotDir, { recursive: true, force: true });
  }
}
