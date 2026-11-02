import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCalendar } from "../../src/calendar";
import type { PricingTable } from "../../src/pricing/rates";
import {
  bucketRequests,
  collectTranscriptUsage,
} from "../../src/transcripts/index";
import type { UsageRequest } from "../../src/transcripts/types";
import { protoBytes, protoNumber, protoText } from "./protobuf";

const pricing: PricingTable = {
  asOf: "2026-10-01T00:00:00.000Z",
  models: {
    "claude-test": {
      input: 1e-6,
      output: 2e-6,
      cacheCreation: 1.25e-6,
      cacheCreation1h: 2e-6,
      cacheRead: 0.1e-6,
    },
  },
};

const request = (overrides: Partial<UsageRequest>): UsageRequest => ({
  timestampMs: Date.parse("2026-10-29T08:15:00.000Z"),
  model: "claude-test",
  sessionId: "s1",
  inputTokens: 100,
  outputTokens: 10,
  cacheCreationTokens: 0,
  cacheCreation1hTokens: 0,
  cacheReadTokens: 0,
  reasoningTokens: null,
  reportedCost: null,
  speed: "standard",
  dedupeKey: null,
  ...overrides,
});

const ALL_TIME: [number, number] = [0, Number.MAX_SAFE_INTEGER];

describe("bucketRequests", () => {
  it("sums requests into account-calendar hours per model", () => {
    // Kolkata is UTC+5:30, so its hours start at half past UTC hours
    const calendar = createCalendar("Asia/Kolkata");
    const buckets = bucketRequests(
      [
        [
          request({ timestampMs: Date.parse("2026-10-29T08:15:00Z") }),
          request({ timestampMs: Date.parse("2026-10-29T08:45:00Z") }),
          request({
            timestampMs: Date.parse("2026-10-29T08:20:00Z"),
            model: "other",
            reasoningTokens: 3,
          }),
          // 23:59 local on the 29th, 00:01 local on the 30th
          request({ timestampMs: Date.parse("2026-10-29T18:29:00Z") }),
          request({ timestampMs: Date.parse("2026-10-29T18:31:00Z") }),
        ],
      ],
      calendar,
      pricing,
      ALL_TIME,
    );
    expect(
      buckets.map(({ date, hourStart, model, requests, reasoningTokens }) => [
        date,
        hourStart,
        model,
        requests,
        reasoningTokens,
      ]),
    ).toEqual([
      ["2026-10-29", "2026-10-29T07:30:00.000Z", "claude-test", 1, undefined],
      ["2026-10-29", "2026-10-29T07:30:00.000Z", "other", 1, 3],
      ["2026-10-29", "2026-10-29T08:30:00.000Z", "claude-test", 1, undefined],
      ["2026-10-29", "2026-10-29T17:30:00.000Z", "claude-test", 1, undefined],
      ["2026-10-30", "2026-10-29T18:30:00.000Z", "claude-test", 1, undefined],
    ]);
  });

  it("counts a repeated request once and drops requests outside the range", () => {
    const calendar = createCalendar("UTC");
    const start = Date.parse("2026-10-29T00:00:00Z");
    const buckets = bucketRequests(
      [
        [request({ dedupeKey: "m:r" }), request({ dedupeKey: "m:r" })],
        [request({ dedupeKey: "m:r" }), request({ timestampMs: start - 1 })],
      ],
      calendar,
      pricing,
      [start, start + 24 * 60 * 60 * 1000],
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({ requests: 1, inputTokens: 100 });
  });

  it("prices each request with its cache lifetime and reports unknown models", () => {
    const buckets = bucketRequests(
      [
        [
          request({
            inputTokens: 1_000,
            outputTokens: 100,
            cacheCreationTokens: 1_000,
            cacheCreation1hTokens: 400,
            cacheReadTokens: 10_000,
          }),
          request({ reportedCost: 0.5 }),
          request({ model: "mystery" }),
        ],
      ],
      createCalendar("UTC"),
      pricing,
      ALL_TIME,
    );
    const priced = 1_000e-6 + 100 * 2e-6 + 600 * 1.25e-6 + 400 * 2e-6 + 1e-3;
    expect(buckets.find((b) => b.model === "claude-test")?.cost).toBeCloseTo(
      priced + 0.5,
      12,
    );
    expect(buckets.find((b) => b.model === "mystery")).toMatchObject({
      cost: 0,
      inputTokens: 100,
    });
    expect(
      buckets.filter((b) => b.unpricedTokens > 0).map((b) => b.model),
    ).toEqual(["mystery"]);
  });
});

describe("collectTranscriptUsage", () => {
  let home: string;
  const calendar = createCalendar("UTC");
  const now = new Date("2026-10-30T12:00:00Z");

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "transcripts-")));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  function write(path: string, lines: unknown[], mtime: Date) {
    const file = join(home, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n"));
    utimesSync(file, mtime, mtime);
  }

  const claudeLine = (timestamp: string, id: string) => ({
    type: "assistant",
    timestamp,
    sessionId: "s1",
    requestId: `req_${id}`,
    message: {
      id: `msg_${id}`,
      model: "claude-test",
      usage: { input_tokens: 100, output_tokens: 10 },
    },
  });

  it("covers the days Claude Code still keeps every transcript of", async () => {
    mkdirSync(join(home, "a/projects"), { recursive: true });
    writeFileSync(
      join(home, "a/settings.json"),
      JSON.stringify({ cleanupPeriodDays: 7 }),
    );
    write(
      "a/projects/p/recent.jsonl",
      [
        claudeLine("2026-10-24T10:00:00Z", "1"),
        claudeLine("2026-10-29T10:00:00Z", "2"),
      ],
      new Date("2026-10-29T10:00:00Z"),
    );
    // The same request read through a second config directory
    write(
      "b/projects/p/copy.jsonl",
      [claudeLine("2026-10-29T10:00:00Z", "2")],
      new Date("2026-10-29T10:00:00Z"),
    );
    // Last written before the range: not read at all
    write(
      "b/projects/p/old.jsonl",
      [claudeLine("2026-10-29T11:00:00Z", "3")],
      new Date("2026-10-01T00:00:00Z"),
    );

    const usage = await collectTranscriptUsage(
      "claude-code",
      calendar,
      pricing,
      {
        claudeConfigDirs: [join(home, "a"), join(home, "b")],
        now,
      },
    );
    expect(usage.range).toEqual({ from: "2026-10-24", to: "2026-10-30" });
    expect(usage.buckets.map(({ date, requests }) => [date, requests])).toEqual(
      [
        ["2026-10-24", 1],
        ["2026-10-29", 1],
      ],
    );
  });

  it("never reaches past the retention period across a 25-hour DST day", async () => {
    mkdirSync(join(home, "d/projects"), { recursive: true });
    writeFileSync(
      join(home, "d/settings.json"),
      JSON.stringify({ cleanupPeriodDays: 7 }),
    );
    // New York falls back on 2026-11-01. At 23:30 on 11-07, seven whole days
    // back reach 00:30 on 11-01: November 1st is only partly retained.
    write(
      "d/projects/p/session.jsonl",
      [
        claudeLine("2026-11-01T16:00:00Z", "1"),
        claudeLine("2026-11-02T17:00:00Z", "2"),
      ],
      new Date("2026-11-02T17:00:00Z"),
    );
    const usage = await collectTranscriptUsage(
      "claude-code",
      createCalendar("America/New_York"),
      pricing,
      {
        claudeConfigDirs: [join(home, "d")],
        now: new Date("2026-11-08T04:30:00Z"),
      },
    );
    expect(usage.range).toEqual({ from: "2026-11-02", to: "2026-11-07" });
    expect(usage.buckets.map(({ date }) => date)).toEqual(["2026-11-02"]);
  });

  it("deduplicates a Codex session found both live and archived", async () => {
    const rollout = [
      { type: "session_meta", payload: { id: "codex-1" } },
      { type: "turn_context", payload: { model: "gpt-test" } },
      {
        type: "event_msg",
        timestamp: "2026-10-29T10:00:00Z",
        payload: {
          type: "token_count",
          info: { last_token_usage: { input_tokens: 10, output_tokens: 5 } },
        },
      },
    ];
    const mtime = new Date("2026-10-29T10:00:00Z");
    write("codex/sessions/2026/10/29/rollout-1.jsonl", rollout, mtime);
    write("codex/archived_sessions/rollout-1.jsonl", rollout, mtime);

    const usage = await collectTranscriptUsage("codex", calendar, pricing, {
      env: { CODEX_HOME: join(home, "codex") },
      now,
    });
    expect(usage.range).toEqual({ from: "2026-10-29", to: "2026-10-30" });
    expect(usage.buckets).toEqual([
      expect.objectContaining({
        model: "gpt-test",
        inputTokens: 10,
        outputTokens: 5,
        reasoningTokens: 0,
        requests: 1,
      }),
    ]);
    expect(usage.buckets[0]?.unpricedTokens).toBe(15);
  });

  it("starts the range at the first request, leaving earlier days alone", async () => {
    mkdirSync(join(home, "c/projects"), { recursive: true });
    const empty = await collectTranscriptUsage(
      "claude-code",
      calendar,
      pricing,
      {
        claudeConfigDirs: [join(home, "c")],
        now,
      },
    );
    expect(empty).toEqual({
      buckets: [],
      malformedRecords: 0,
    });

    write(
      "c/projects/p/today.jsonl",
      [claudeLine("2026-10-30T09:00:00Z", "1")],
      now,
    );
    const usage = await collectTranscriptUsage(
      "claude-code",
      calendar,
      pricing,
      {
        claudeConfigDirs: [join(home, "c")],
        now,
      },
    );
    expect(usage.range).toEqual({ from: "2026-10-30", to: "2026-10-30" });
  });

  it.each([
    // Claude Code deletes transcripts after 30 days: older days may be partial
    ["claude-code", "2026-10-01"],
    // Codex keeps every transcript: every day it covers is complete
    ["codex", undefined],
  ] as const)(
    "backfills old %s buckets, claiming old days complete only while every transcript is kept",
    async (agent, backfillBefore) => {
      const old = "2025-01-01T10:00:00Z";
      if (agent === "claude-code") {
        write(
          "history/projects/p/s.jsonl",
          [claudeLine(old, "old"), claudeLine("2026-10-29T10:00:00Z", "new")],
          now,
        );
      } else {
        write(
          "history/sessions/s.jsonl",
          [
            { type: "turn_context", payload: { model: "gpt-test" } },
            {
              type: "event_msg",
              timestamp: old,
              payload: {
                type: "token_count",
                info: {
                  last_token_usage: { input_tokens: 10, output_tokens: 5 },
                },
              },
            },
            {
              type: "event_msg",
              timestamp: "2026-10-29T10:00:00Z",
              payload: {
                type: "token_count",
                info: {
                  last_token_usage: { input_tokens: 20, output_tokens: 5 },
                },
              },
            },
          ],
          now,
        );
      }
      const options = {
        now,
        claudeConfigDirs: [join(home, "history")],
        env: { CODEX_HOME: join(home, "history") },
      };
      const recent = await collectTranscriptUsage(
        agent,
        calendar,
        pricing,
        options,
      );
      expect(recent.buckets.map((b) => b.date)).toEqual(["2026-10-29"]);
      expect(recent.backfillBefore).toBeUndefined();
      const full = await collectTranscriptUsage(agent, calendar, pricing, {
        ...options,
        fullHistory: true,
      });
      expect(full.buckets.map((b) => b.date)).toEqual([
        "2025-01-01",
        "2026-10-29",
      ]);
      expect(full.backfillBefore).toBe(backfillBefore);
      expect(full.range).toEqual({ from: "2026-10-29", to: "2026-10-30" });
    },
  );

  it("claims Claude Code days complete as far back as its retention period, beyond the refresh window", async () => {
    mkdirSync(join(home, "long/projects"), { recursive: true });
    writeFileSync(
      join(home, "long/settings.json"),
      JSON.stringify({ cleanupPeriodDays: 90 }),
    );
    write(
      "long/projects/p/s.jsonl",
      [
        claudeLine("2026-08-15T10:00:00Z", "1"),
        claudeLine("2026-10-29T10:00:00Z", "2"),
      ],
      now,
    );
    const full = await collectTranscriptUsage(
      "claude-code",
      calendar,
      pricing,
      {
        now,
        claudeConfigDirs: [join(home, "long")],
        fullHistory: true,
      },
    );
    expect(full.buckets.map((b) => b.date)).toEqual([
      "2026-08-15",
      "2026-10-29",
    ]);
    // Every sync still re-reads 30 days; the backfill replaces 90
    expect(full.range).toEqual({ from: "2026-10-29", to: "2026-10-30" });
    expect(full.backfillBefore).toBe("2026-08-02");
  });

  it("reads old files on a history-only backfill without creating a long replacement range", async () => {
    write(
      "c/projects/p/old.jsonl",
      [claudeLine("2024-01-01T10:00:00Z", "old")],
      new Date("2024-01-01T10:00:00Z"),
    );
    const result = await collectTranscriptUsage(
      "claude-code",
      calendar,
      pricing,
      { now, claudeConfigDirs: [join(home, "c")], fullHistory: true },
    );
    expect(result.buckets.map((b) => b.date)).toEqual(["2024-01-01"]);
    expect(result.range).toBeUndefined();
    expect(result.backfillBefore).toBe("2026-10-01");
  });

  it("fails instead of reporting empty usage when the agent has no data directory", async () => {
    await expect(
      collectTranscriptUsage("claude-code", calendar, pricing, {
        claudeConfigDirs: [join(home, "missing")],
        now,
      }),
    ).rejects.toThrow("Cannot read configured Claude Code directory");
    await expect(
      collectTranscriptUsage("codex", calendar, pricing, {
        env: { CODEX_HOME: join(home, "missing") },
        now,
      }),
    ).rejects.toThrow("No Codex sessions found");
    await expect(
      collectTranscriptUsage("opencode", calendar, pricing, {
        env: { XDG_DATA_HOME: join(home, "missing") },
        now,
      }),
    ).rejects.toThrow("No OpenCode data found");
    await expect(
      collectTranscriptUsage("antigravity", calendar, pricing, {
        env: { ANTIGRAVITY_DATA_DIR: join(home, "missing") },
        now,
      }),
    ).rejects.toThrow("Cannot read configured Antigravity directory");
  });

  function openDb(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(dbPath);
  }

  it("prices OpenCode requests the agent did not and keeps the recent range", async () => {
    const root = join(home, "xdg", "opencode");
    mkdirSync(root, { recursive: true });
    const db = openDb(join(root, "opencode.db"));
    db.exec(
      "CREATE TABLE message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER)",
    );
    const insert = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    const row = (id: string, created: string, cost: number) => {
      const timestampMs = Date.parse(created);
      insert.run(
        id,
        "s1",
        JSON.stringify({
          role: "assistant",
          modelID: "claude-test",
          time: { created: timestampMs },
          cost,
          tokens: { input: 100, output: 10, reasoning: 2 },
        }),
        timestampMs,
      );
    };
    row("old", "2025-01-01T10:00:00Z", 0);
    row("priced", "2026-10-29T10:00:00Z", 0.5);
    row("unpriced", "2026-10-29T11:00:00Z", 0);
    db.close();

    const usage = await collectTranscriptUsage("opencode", calendar, pricing, {
      env: { XDG_DATA_HOME: join(home, "xdg") },
      now,
    });
    expect(usage.range).toEqual({ from: "2026-10-29", to: "2026-10-30" });
    expect(
      usage.buckets.map(({ hourStart, requests, reasoningTokens }) => [
        hourStart,
        requests,
        reasoningTokens,
      ]),
    ).toEqual([
      ["2026-10-29T10:00:00.000Z", 1, 2],
      ["2026-10-29T11:00:00.000Z", 1, 2],
    ]);
    // The agent's own cost is kept; a zero cost is priced from the table
    expect(usage.buckets[0]!.cost).toBe(0.5);
    expect(usage.buckets[1]!.cost).toBeCloseTo(100e-6 + 12 * 2e-6, 12);
    const full = await collectTranscriptUsage("opencode", calendar, pricing, {
      env: { XDG_DATA_HOME: join(home, "xdg") },
      now,
      fullHistory: true,
    });
    expect([...new Set(full.buckets.map((b) => b.date))]).toEqual([
      "2025-01-01",
      "2026-10-29",
    ]);
    // OpenCode keeps every session: the old day is stated completely
    expect(full.backfillBefore).toBeUndefined();
  });

  it("buckets Antigravity generations by their own time", async () => {
    const conversations = join(home, ".gemini", "antigravity", "conversations");
    mkdirSync(conversations, { recursive: true });
    const db = openDb(join(conversations, "session.db"));
    db.exec("CREATE TABLE steps (idx INTEGER, metadata BLOB)");
    // Usage: model id 246, 100 input, 40 output, a response id; its own time
    const usage = [
      ...protoNumber(1, 246),
      ...protoNumber(2, 100),
      ...protoNumber(3, 40),
      ...protoText(11, "r-1"),
    ];
    const stamp = protoNumber(1, Date.parse("2026-10-29T10:00:00Z") / 1000);
    db.prepare("INSERT INTO steps VALUES (?, ?)").run(
      0,
      new Uint8Array([...protoBytes(9, usage), ...protoBytes(8, stamp)]),
    );
    db.close();

    const usageByHour = await collectTranscriptUsage(
      "antigravity",
      calendar,
      pricing,
      {
        env: { ANTIGRAVITY_DATA_DIR: join(home, ".gemini", "antigravity") },
        now,
      },
    );
    expect(usageByHour.range).toEqual({ from: "2026-10-29", to: "2026-10-30" });
    expect(usageByHour.buckets).toEqual([
      expect.objectContaining({
        hourStart: "2026-10-29T10:00:00.000Z",
        model: "gemini-2.5-pro",
        inputTokens: 100,
        outputTokens: 40,
        reasoningTokens: 0,
        requests: 1,
        cost: 0,
        unpricedTokens: 140,
      }),
    ]);
  });
});
