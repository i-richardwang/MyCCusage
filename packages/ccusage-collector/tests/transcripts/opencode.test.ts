import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openCodeDataDirs,
  parseOpenCodeMessage,
  readOpenCodeUsage,
} from "../../src/transcripts/opencode";

function openDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

const SINCE = 1780000000000;

const message = {
  id: "msg-1",
  sessionID: "session-1",
  role: "assistant",
  modelID: "claude-sonnet-4-5",
  time: { created: SINCE },
  cost: 0.25,
  tokens: {
    input: 100,
    output: 20,
    reasoning: 5,
    cache: { read: 30, write: 10 },
  },
};

// `message` without one of its fields
function without(field: keyof typeof message): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(message).filter(([key]) => key !== field),
  );
}

describe("parseOpenCodeMessage", () => {
  it("reads the request behind an assistant message, reasoning as output", () => {
    expect(parseOpenCodeMessage(JSON.stringify(message))).toEqual({
      timestampMs: SINCE,
      model: "claude-sonnet-4-5",
      sessionId: "session-1",
      inputTokens: 100,
      outputTokens: 25,
      cacheCreationTokens: 10,
      cacheCreation1hTokens: 0,
      cacheReadTokens: 30,
      reasoningTokens: 5,
      reportedCost: 0.25,
      speed: "standard",
      dedupeKey: "opencode:msg-1",
    });
  });

  it("prefers the row's id, session and time over the message's", () => {
    const parsed = parseOpenCodeMessage(
      JSON.stringify({ ...message, time: {} }),
      { id: "row-1", sessionId: "row-session", timestampMs: SINCE + 1 },
    );
    expect(parsed).toMatchObject({
      timestampMs: SINCE + 1,
      sessionId: "row-session",
      dedupeKey: "opencode:row-1",
    });
  });

  it("reads the model from any of OpenCode's shapes", () => {
    for (const model of [
      { model: { id: "m" } },
      { model: { modelID: "m" } },
      { modelID: "m" },
    ]) {
      expect(
        parseOpenCodeMessage(
          JSON.stringify({ ...without("modelID"), ...model }),
        )?.model,
      ).toBe("m");
    }
  });

  it("leaves a zero or missing cost to be priced", () => {
    expect(
      parseOpenCodeMessage(JSON.stringify({ ...message, cost: 0 }))
        ?.reportedCost,
    ).toBeNull();
    expect(
      parseOpenCodeMessage(JSON.stringify(without("cost")))?.reportedCost,
    ).toBeNull();
  });

  it("ignores user messages, messages without a model or time, and empty usage", () => {
    expect(
      parseOpenCodeMessage(JSON.stringify({ ...message, role: "user" })),
    ).toBeNull();
    expect(parseOpenCodeMessage(JSON.stringify(without("modelID")))).toBeNull();
    expect(
      parseOpenCodeMessage(JSON.stringify({ ...message, time: {} })),
    ).toBeNull();
    expect(
      parseOpenCodeMessage(JSON.stringify({ ...message, tokens: {} })),
    ).toBeNull();
    expect(parseOpenCodeMessage("{invalid")).toBeNull();
    expect(parseOpenCodeMessage("[]")).toBeNull();
  });
});

describe("readOpenCodeUsage", () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "opencode-usage-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeLegacy(
    sessionId: string,
    id: string,
    mtimeMs: number,
    body: unknown = { ...message, id, sessionID: sessionId },
  ): string {
    const legacy = join(dir, "storage", "message", sessionId);
    mkdirSync(legacy, { recursive: true });
    const file = join(legacy, `${id}.json`);
    writeFileSync(file, JSON.stringify(body));
    utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
    return file;
  }

  it("reads a migrated message from the database and the legacy store, keyed once", async () => {
    const db = openDb(join(dir, "opencode.db"));
    db.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)");
    db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
      message.id,
      message.sessionID,
      JSON.stringify(message),
    );
    db.close();
    writeLegacy(message.sessionID, message.id, SINCE);

    const files = await readOpenCodeUsage(dir, 0);
    expect(files.map((requests) => requests.map((r) => r.dedupeKey))).toEqual([
      ["opencode:msg-1"],
      ["opencode:msg-1"],
    ]);
    expect(files[0]![0]).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 30,
      cacheCreationTokens: 10,
      outputTokens: 25,
      reasoningTokens: 5,
      reportedCost: 0.25,
    });
  });

  it("reads only dated rows in the window, from every opencode database", async () => {
    const db = openDb(join(dir, "opencode.db"));
    db.exec(
      "CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER)",
    );
    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    const row = (id: string, created: number, body: unknown = {}) =>
      insert.run(
        id,
        "session-1",
        JSON.stringify({ ...message, id, time: {}, ...(body as object) }),
        created,
      );
    row("old", SINCE - 1);
    row("new", SINCE);
    row("user", SINCE, { role: "user" });
    db.close();
    const other = openDb(join(dir, "opencode-work.db"));
    other.exec(
      "CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, data TEXT, time_created INTEGER)",
    );
    other
      .prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?)")
      .run(
        "legacy-table",
        "session-2",
        "assistant",
        JSON.stringify({ ...message, id: "legacy-table", time: {} }),
        SINCE + 5,
      );
    other.close();
    // Ignored: not an OpenCode database name
    writeFileSync(join(dir, "notes.db"), "");

    const files = await readOpenCodeUsage(dir, SINCE);
    expect(
      files.map((requests) =>
        requests.map((r) => [r.dedupeKey, r.timestampMs, r.sessionId]),
      ),
    ).toEqual([
      [["opencode:new", SINCE, "session-1"]],
      [["opencode:legacy-table", SINCE + 5, "session-2"]],
    ]);
  });

  it("reads every row of a database without time_created on a full-history scan", async () => {
    const db = openDb(join(dir, "opencode.db"));
    db.exec("CREATE TABLE message (id TEXT, session_id TEXT, data TEXT)");
    db.prepare("INSERT INTO message VALUES (?, ?, ?)").run(
      "any",
      "s",
      JSON.stringify({ ...message, id: "any", time: { created: 1 } }),
    );
    db.close();
    expect((await readOpenCodeUsage(dir, -Infinity)).flat()).toHaveLength(1);
    // Undated rows are read whatever the window; the caller applies it
    expect((await readOpenCodeUsage(dir, SINCE)).flat()).toHaveLength(1);
  });

  it("fails on a database without a message table", async () => {
    const db = openDb(join(dir, "opencode.db"));
    db.exec("CREATE TABLE session (id TEXT)");
    db.close();
    await expect(readOpenCodeUsage(dir, 0)).rejects.toThrow(
      /Cannot read OpenCode database .*opencode\.db: no message table/,
    );
  });

  it("skips legacy messages last written before the window", async () => {
    writeLegacy("session-1", "msg-old", SINCE - 60_000);
    expect(await readOpenCodeUsage(dir, SINCE)).toEqual([]);
    writeLegacy("session-1", "msg-new", SINCE + 60_000);
    const files = await readOpenCodeUsage(dir, SINCE);
    expect(files.flat().map((r) => r.dedupeKey)).toEqual(["opencode:msg-new"]);
  });

  it("never follows symbolic links in the legacy store", async () => {
    const outside = realpathSync(
      mkdtempSync(join(tmpdir(), "opencode-outside-")),
    );
    try {
      const store = join(dir, "storage", "message");
      const session = join(store, "session-1");
      mkdirSync(session, { recursive: true });
      const linked = join(outside, "msg-linked.json");
      writeFileSync(linked, JSON.stringify({ ...message, id: "msg-linked" }));
      symlinkSync(linked, join(session, "msg-linked.json"));
      symlinkSync(outside, join(store, "session-linked"));
      symlinkSync(store, join(session, "cycle"));
      symlinkSync(join(outside, "gone.json"), join(session, "gone.json"));
      expect(await readOpenCodeUsage(dir, 0)).toEqual([]);

      writeLegacy("session-1", "msg-real", SINCE);
      const files = await readOpenCodeUsage(dir, 0);
      expect(files.flat().map((r) => r.dedupeKey)).toEqual([
        "opencode:msg-real",
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("openCodeDataDirs", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "opencode-home-")));
    vi.stubEnv("HOME", home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("reads the configured list once per directory", () => {
    const configured = join(home, "instance");
    const alias = join(home, "alias");
    mkdirSync(configured);
    symlinkSync(configured, alias);
    expect(
      openCodeDataDirs({ OPENCODE_DATA_DIR: ` ${configured}, ${alias}, , ` }),
    ).toEqual([configured]);
  });

  it("falls back to an absolute XDG_DATA_HOME, then to the home default", () => {
    expect(openCodeDataDirs({})).toEqual([]);
    mkdirSync(join(home, ".local", "share", "opencode"), { recursive: true });
    expect(openCodeDataDirs({})).toEqual([
      join(home, ".local", "share", "opencode"),
    ]);
    // A relative XDG_DATA_HOME is invalid and ignored
    expect(openCodeDataDirs({ XDG_DATA_HOME: "relative" })).toEqual([
      join(home, ".local", "share", "opencode"),
    ]);
    mkdirSync(join(home, "xdg", "opencode"), { recursive: true });
    expect(openCodeDataDirs({ XDG_DATA_HOME: join(home, "xdg") })).toEqual([
      join(home, "xdg", "opencode"),
    ]);
  });

  it("fails on a configured directory that does not exist", () => {
    expect(() =>
      openCodeDataDirs({ OPENCODE_DATA_DIR: join(home, "missing") }),
    ).toThrow("Cannot read configured OpenCode directory");
  });
});
