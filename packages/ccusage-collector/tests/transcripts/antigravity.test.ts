// Test cases ported from T3 Code's antigravityUsageReader.test.ts (MIT).
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
  antigravityConversationDirs,
  readAntigravityUsage,
} from "../../src/transcripts/antigravity";
import type { UsageRequest } from "../../src/transcripts/types";
import { protoBytes, protoNumber, protoText } from "./protobuf";

function openDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

const blob = (bytes: readonly number[]) => new Uint8Array(bytes);

const GEN_METADATA_TABLE = "CREATE TABLE gen_metadata (idx INTEGER, data BLOB)";
const STEPS_TABLE = "CREATE TABLE steps (idx INTEGER, metadata BLOB)";
const TABLES = [GEN_METADATA_TABLE, STEPS_TABLE];

type Db = ReturnType<typeof openDb>;

function seed(path: string, tables: string[], write: (db: Db) => void): void {
  const db = openDb(path);
  try {
    for (const table of tables) db.exec(table);
    write(db);
  } finally {
    db.close();
  }
}

const generation = (responseId: string, seconds = 1780000000) =>
  blob(
    protoBytes(1, [
      ...protoBytes(4, [
        ...protoNumber(2, 100),
        ...protoNumber(3, 40),
        ...protoText(11, responseId),
      ]),
      ...protoText(19, "Gemini 3 Pro"),
      ...protoBytes(9, protoBytes(4, protoNumber(1, seconds))),
    ]),
  );

const stepUsage = (responseId: string) =>
  blob(protoBytes(9, [...protoNumber(2, 10), ...protoText(11, responseId)]));

const totals = (request: UsageRequest) => ({
  inputTokens: request.inputTokens,
  cacheReadTokens: request.cacheReadTokens,
  cacheCreationTokens: request.cacheCreationTokens,
  outputTokens: request.outputTokens,
  reasoningTokens: request.reasoningTokens,
});

describe("readAntigravityUsage", () => {
  let dir: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "antigravity-usage-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const read = async (dirs: string[] = [dir], sinceMs = -Infinity) =>
    (await readAntigravityUsage(dirs, sinceMs)).flat();

  it("merges a generation's step and metadata records, keeping each retry on its own model", async () => {
    const stamp = protoNumber(1, 1780000000);
    const usage = [
      ...protoNumber(2, 100),
      ...protoNumber(3, 40),
      ...protoNumber(4, 5),
      ...protoNumber(5, 20),
      ...protoNumber(9, 10),
      ...protoText(11, "response-1"),
    ];
    const retry = [
      ...protoNumber(1, 1026),
      ...protoNumber(2, 12),
      ...protoNumber(3, 3),
      ...protoText(11, "retry-1"),
    ];
    seed(join(dir, "session-1.db"), TABLES, (db) => {
      db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
        0,
        blob(
          protoBytes(1, [
            ...protoBytes(4, usage),
            ...protoText(19, "Gemini 3 Pro"),
            ...protoBytes(9, protoBytes(4, stamp)),
          ]),
        ),
      );
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(
        0,
        blob([
          ...protoBytes(9, usage),
          ...protoBytes(8, stamp),
          ...protoBytes(28, protoBytes(2, retry)),
        ]),
      );
    });
    const requests = await read();
    expect(requests).toHaveLength(2);
    const main = requests.find((r) => r.model === "gemini-3-pro")!;
    expect(main).toMatchObject({
      timestampMs: 1780000000000,
      sessionId: "session-1",
      dedupeKey: "antigravity:11:response-1",
      reportedCost: null,
      speed: "standard",
    });
    expect(totals(main)).toEqual({
      inputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      outputTokens: 40,
      reasoningTokens: 10,
    });
    expect(
      requests.find((r) => r.model === "claude-opus-4-6")?.inputTokens,
    ).toBe(12);
  });

  it("gives a model-less step the model of its generation", async () => {
    seed(join(dir, "model-switch.db"), TABLES, (db) => {
      for (const [idx, name] of ["Gemini 3 Pro", "Claude Opus 4.6"].entries()) {
        db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
          idx,
          blob(protoBytes(1, protoText(19, name))),
        );
        db.prepare("INSERT INTO steps VALUES (?, ?)").run(
          idx,
          blob(protoBytes(9, protoNumber(2, 10 + idx))),
        );
      }
    });
    expect((await read()).map((r) => r.model)).toEqual([
      "gemini-3-pro",
      "claude-opus-4-6",
    ]);
  });

  it("prices thinking-level variants at the base model's rates", async () => {
    seed(join(dir, "effort.db"), TABLES, (db) => {
      for (const [idx, name] of [
        "gemini-4-argon-high",
        "gemini-4-argon",
      ].entries()) {
        db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
          idx,
          blob(protoBytes(1, protoText(19, name))),
        );
        db.prepare("INSERT INTO steps VALUES (?, ?)").run(
          idx,
          blob(protoBytes(9, protoNumber(2, 10 + idx))),
        );
      }
    });
    expect(
      (await read()).map(({ model, rateModel }) => [model, rateModel]),
    ).toEqual([
      ["gemini-4-argon-high", "gemini-4-argon"],
      ["gemini-4-argon", undefined],
    ]);
  });

  it("merges records an alias bridges after they were read apart", async () => {
    seed(join(dir, "bridge.db"), TABLES, (db) => {
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(
        0,
        blob(
          protoBytes(9, [...protoNumber(2, 100), ...protoText(11, "response")]),
        ),
      );
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(
        1,
        blob(
          protoBytes(9, [...protoNumber(3, 40), ...protoText(12, "provider")]),
        ),
      );
      db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
        0,
        blob(
          protoBytes(1, [
            ...protoText(19, "Gemini 3 Pro"),
            ...protoBytes(4, [
              ...protoNumber(2, 50),
              ...protoNumber(5, 20),
              ...protoText(11, "response"),
              ...protoText(12, "provider"),
            ]),
          ]),
        ),
      );
    });
    const requests = await read();
    expect(requests).toHaveLength(1);
    expect(totals(requests[0]!)).toEqual({
      inputTokens: 100,
      cacheReadTokens: 20,
      cacheCreationTokens: 0,
      outputTokens: 40,
      reasoningTokens: 0,
    });
  });

  it("merges aliases across roots, keeping the first file's identity", async () => {
    const roots = [join(dir, "first"), join(dir, "second")];
    for (const [index, root] of roots.entries()) {
      mkdirSync(root);
      seed(join(root, `session-${index}.db`), [STEPS_TABLE], (db) => {
        for (const identity of [7, 12]) {
          db.prepare("INSERT INTO steps VALUES (?, ?)").run(
            identity,
            blob(
              protoBytes(9, [
                ...protoNumber(1, 246),
                ...protoNumber(2, index === 0 ? 100 : 150),
                ...protoText(11, `response-${index}-${identity}`),
                ...protoText(identity, `shared-${identity}`),
              ]),
            ),
          );
        }
      });
    }
    const files = await readAntigravityUsage(roots, -Infinity);
    expect(files.map((requests) => requests.length)).toEqual([2, 0]);
    expect(files[0]!.map((r) => r.inputTokens)).toEqual([150, 150]);
    expect(files[0]!.every((r) => r.sessionId === "session-0")).toBe(true);
    expect(files[0]!.every((r) => r.model === "gemini-2.5-pro")).toBe(true);
  });

  it("dates records by their row, else the conversation, else the file", async () => {
    for (const fallback of ["mtime", "trajectory"]) {
      const file = join(dir, `${fallback}.db`);
      seed(file, TABLES, (db) => {
        if (fallback === "trajectory") {
          db.exec("CREATE TABLE trajectory_metadata_blob (data BLOB)");
          db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(
            blob(protoBytes(2, protoNumber(1, 1780000200))),
          );
        }
        for (const [index, seconds] of [1780000000, 1780000200].entries()) {
          const usage = [
            ...protoNumber(2, 10),
            ...protoText(11, `${fallback}-${index}`),
          ];
          // The step has no time of its own; its generation does
          db.prepare("INSERT INTO steps VALUES (?, ?)").run(
            index,
            blob(protoBytes(9, usage)),
          );
          db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
            index,
            blob(
              protoBytes(1, [
                ...protoBytes(4, usage),
                ...protoBytes(9, protoBytes(4, protoNumber(1, seconds))),
              ]),
            ),
          );
        }
      });
      utimesSync(file, 1780000000, 1780000000);
    }
    const requests = await read();
    expect(requests.map((r) => r.timestampMs).sort()).toEqual([
      1780000000000, 1780000000000, 1780000200000, 1780000200000,
    ]);

    // Without any time of its own, a record takes the conversation's, then
    // the file's last write
    seed(join(dir, "only-trajectory.db"), [STEPS_TABLE], (db) => {
      db.exec("CREATE TABLE trajectory_metadata_blob (data BLOB)");
      db.prepare("INSERT INTO trajectory_metadata_blob VALUES (?)").run(
        blob(protoBytes(2, protoNumber(1, 1780000300))),
      );
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(0, stepUsage("t-only"));
    });
    seed(join(dir, "only-mtime.db"), [STEPS_TABLE], (db) => {
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(0, stepUsage("m-only"));
    });
    utimesSync(join(dir, "only-mtime.db"), 1780000400, 1780000400);
    const dated = await read();
    expect(
      dated.find((r) => r.dedupeKey === "antigravity:11:t-only")?.timestampMs,
    ).toBe(1780000300000);
    expect(
      dated.find((r) => r.dedupeKey === "antigravity:11:m-only")?.timestampMs,
    ).toBe(1780000400000);
  });

  it("keeps only requests dated at or after sinceMs once their aliases are merged", async () => {
    // The generation's time lives in an older database; its retry record in a
    // recent one has no time of its own and would otherwise take the file's
    seed(join(dir, "old.db"), [GEN_METADATA_TABLE], (db) => {
      db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
        0,
        blob(
          protoBytes(1, [
            ...protoBytes(4, [...protoNumber(2, 10), ...protoText(11, "old")]),
            ...protoBytes(9, protoBytes(4, protoNumber(1, 1780000000))),
          ]),
        ),
      );
    });
    utimesSync(join(dir, "old.db"), 1780000000, 1780000000);
    seed(join(dir, "recent.db"), [STEPS_TABLE], (db) => {
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(0, stepUsage("old"));
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(
        1,
        blob(
          protoBytes(9, [
            ...protoNumber(1, 1780090000),
            ...protoNumber(2, 10),
            ...protoText(11, "recent"),
          ]),
        ),
      );
    });
    utimesSync(join(dir, "recent.db"), 1780090000, 1780090000);

    const requests = await read([dir], 1780050000000);
    expect(requests.map((r) => r.dedupeKey)).toEqual([
      "antigravity:11:recent",
    ]);
    expect((await read()).map((r) => r.timestampMs).sort()).toEqual([
      1780000000000, 1780090000000,
    ]);
  });

  it("reads step-only stores, including rows written to the WAL", async () => {
    const path = join(dir, "steps.db");
    const db = openDb(path);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA wal_autocheckpoint = 0");
    db.exec(STEPS_TABLE);
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(
      0,
      blob([
        ...protoBytes(9, [
          ...protoNumber(1, 246),
          ...protoNumber(2, 10),
          ...protoNumber(3, 5),
        ]),
        ...protoBytes(8, protoNumber(1, 1780000000)),
      ]),
    );
    // Left open: the rows live only in the WAL while this handle holds them
    try {
      const requests = await read();
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        model: "gemini-2.5-pro",
        outputTokens: 5,
        timestampMs: 1780000000000,
      });
    } finally {
      db.close();
    }
  });

  it("fails on a database that is not an Antigravity conversation", async () => {
    writeFileSync(join(dir, "broken.db"), "not a sqlite database");
    await expect(read()).rejects.toThrow(
      /Cannot read Antigravity conversation .*broken\.db/,
    );
    rmSync(join(dir, "broken.db"));
    seed(join(dir, "other.db"), ["CREATE TABLE other (id INTEGER)"], () => {});
    await expect(read()).rejects.toThrow("no gen_metadata or steps table");
  });

  it("ignores large values in unused protobuf fields", async () => {
    seed(join(dir, "large-varint.db"), [STEPS_TABLE], (db) => {
      const unusedField = [
        ...protoNumber(99, 0).slice(0, -1),
        ...Array(9).fill(0xff),
        0x01,
      ];
      db.prepare("INSERT INTO steps VALUES (?, ?)").run(
        0,
        blob(
          protoBytes(9, [
            ...protoNumber(1, 246),
            ...protoNumber(2, 10),
            ...unusedField,
          ]),
        ),
      );
    });
    expect((await read())[0]?.inputTokens).toBe(10);
  });

  it("returns records in idx order however the rows are stored", async () => {
    seed(join(dir, "session-1.db"), TABLES, (db) => {
      db.exec("BEGIN");
      for (let idx = 99; idx >= 0; idx--) {
        db.prepare("INSERT INTO steps VALUES (?, ?)").run(
          idx,
          stepUsage(`s-${idx}`),
        );
      }
      for (const idx of [1, 0]) {
        db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
          idx,
          generation(`g-${idx}`),
        );
      }
      db.exec("COMMIT");
    });
    expect((await read()).map((r) => r.dedupeKey)).toEqual([
      ...Array.from({ length: 100 }, (_, idx) => `antigravity:11:s-${idx}`),
      "antigravity:11:g-0",
      "antigravity:11:g-1",
    ]);
  });

  it("reads nested directories once each and never follows symbolic links", async () => {
    mkdirSync(join(dir, "nested"));
    seed(join(dir, "nested", "a.db"), TABLES, (db) => {
      db.prepare("INSERT INTO gen_metadata VALUES (?, ?)").run(
        0,
        generation("nested"),
      );
    });
    symlinkSync(join(dir, "nested"), join(dir, "link-dir"));
    symlinkSync(join(dir, "nested", "a.db"), join(dir, "link.db"));
    const files = await readAntigravityUsage(
      [dir, join(dir, "nested")],
      -Infinity,
    );
    expect(files.flat().map((r) => r.dedupeKey)).toEqual([
      "antigravity:11:nested",
    ]);
  });
});

describe("antigravityConversationDirs", () => {
  let home: string;

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "antigravity-home-")));
    vi.stubEnv("HOME", home);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });

  it("uses each configured root's conversations directory, or the root itself", () => {
    const withConversations = join(home, "ide");
    mkdirSync(join(withConversations, "conversations"), { recursive: true });
    const bare = join(home, "bare");
    mkdirSync(bare);
    const alias = join(home, "alias");
    symlinkSync(bare, alias);
    expect(
      antigravityConversationDirs({
        ANTIGRAVITY_DATA_DIR: `${withConversations}, ${bare},${alias}`,
      }),
    ).toEqual([join(withConversations, "conversations"), bare]);
  });

  it("reads whichever default roots exist", () => {
    expect(antigravityConversationDirs({})).toEqual([]);
    mkdirSync(join(home, ".gemini", "antigravity", "conversations"), {
      recursive: true,
    });
    mkdirSync(join(home, ".config", "antigravity"), { recursive: true });
    expect(antigravityConversationDirs({})).toEqual([
      join(home, ".gemini", "antigravity", "conversations"),
      join(home, ".config", "antigravity"),
    ]);
  });

  it("fails on a configured root that does not exist", () => {
    expect(() =>
      antigravityConversationDirs({
        ANTIGRAVITY_DATA_DIR: join(home, "missing"),
      }),
    ).toThrow("Cannot read configured Antigravity directory");
  });
});
