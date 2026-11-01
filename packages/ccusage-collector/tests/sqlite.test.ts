import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hexBytes, queryRows, withDatabase } from "../src/sqlite";

function openDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

describe("sqlite", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "myccusage-sqlite-test-"));
    path = join(dir, "store.db");
    const db = openDb(path);
    db.exec("CREATE TABLE t (idx INTEGER, data BLOB)");
    db.prepare("INSERT INTO t VALUES (?, ?)").run(
      1,
      new Uint8Array([10, 11, 0, 255]),
    );
    db.prepare("INSERT INTO t VALUES (?, ?)").run(2, null);
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("runs several queries on one open database", () => {
    const result = withDatabase(path, (query) => ({
      tables: query("SELECT name FROM sqlite_master WHERE type = 'table'").map(
        (row) => row.name,
      ),
      rows: query("SELECT idx FROM t ORDER BY idx").map((row) => row.idx),
    }));
    expect(result).toEqual({ tables: ["t"], rows: [1, 2] });
    expect(queryRows(path, "SELECT count(*) AS n FROM t")).toEqual([{ n: 2 }]);
  });

  it("decodes BLOB columns selected as hex", () => {
    const rows = queryRows(
      path,
      "SELECT idx, hex(data) AS data FROM t ORDER BY idx",
    );
    expect(hexBytes(rows[0]!.data)).toEqual(new Uint8Array([10, 11, 0, 255]));
    expect(hexBytes(rows[1]!.data)).toBeNull();
    expect(hexBytes(null)).toBeNull();
    expect(() => hexBytes("zz")).toThrow("hex-encoded");
  });

  it("reads through a writer's lock from a snapshot copy", () => {
    const writer = openDb(path);
    // An exclusive writer keeps its lock between statements
    writer.exec("PRAGMA locking_mode = EXCLUSIVE");
    writer.prepare("INSERT INTO t VALUES (?, ?)").run(3, null);
    try {
      expect(() =>
        openDb(path).prepare("SELECT count(*) FROM t").all(),
      ).toThrow(/locked/);
      expect(queryRows(path, "SELECT count(*) AS n FROM t")).toEqual([
        { n: 3 },
      ]);
    } finally {
      writer.close();
    }
  });
});
