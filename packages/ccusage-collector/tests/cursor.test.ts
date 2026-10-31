import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateCursorUsage,
  collectCursorUsage,
  parseCursorCsv,
  resolveCursorFetchTimeout,
} from "../src/cursor";
import { createCalendar } from "../src/calendar";

const SHANGHAI = createCalendar("Asia/Shanghai");

const TOKEN =
  `header.` +
  Buffer.from(JSON.stringify({ sub: "auth0|cursor-test-user" })).toString(
    "base64url",
  ) +
  `.test-signature`;

function openDb(dbPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

function seedTokenDb(dbPath: string) {
  const db = openDb(dbPath);
  try {
    db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`);
    db.exec(
      `INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', '${TOKEN}')`,
    );
  } finally {
    db.close();
  }
}

const CSV_HEADER =
  "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you";

describe("parseCursorCsv", () => {
  it("sums rows into account-calendar hours per model", () => {
    const rows = parseCursorCsv(
      [
        CSV_HEADER,
        '2026-09-07T01:02:00Z,cheap-model,110,100,30,40,280,"$0.10","$0.05"',
        '2026-09-07T01:40:00Z,cheap-model,10,10,0,1,11,"$0.20","$0.10"',
        '2026-09-07T02:00:00Z,pricey-model,10,10,0,1,11,"$2.00","$1.00"',
        '2026-09-08T01:00:00Z,cheap-model,50,50,0,5,55,"$0.05","$0.02"',
      ].join("\n"),
    );

    const buckets = aggregateCursorUsage(rows, SHANGHAI);
    expect(
      buckets.map(({ date, hourStart, model, requests }) => [
        date,
        hourStart,
        model,
        requests,
      ]),
    ).toEqual([
      ["2026-09-07", "2026-09-07T01:00:00.000Z", "cheap-model", 2],
      ["2026-09-07", "2026-09-07T02:00:00.000Z", "pricey-model", 1],
      ["2026-09-08", "2026-09-08T01:00:00.000Z", "cheap-model", 1],
    ]);
    // input = w/o count; creation = w/ minus w/o; Cost preferred over Cost to you.
    expect(buckets[0]).toMatchObject({
      inputTokens: 110,
      outputTokens: 41,
      cacheCreationTokens: 10,
      cacheReadTokens: 30,
    });
    expect(buckets[0]?.cost).toBeCloseTo(0.3, 10);
    expect(buckets[0]).not.toHaveProperty("reasoningTokens");
  });

  it("falls back to Cost to you when Cost is absent", () => {
    const rows = parseCursorCsv(
      [
        "Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Cost to you",
        "2026-09-07T01:02:00Z,test-model,10,10,0,5,$0.42",
      ].join("\n"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cost).toBeCloseTo(0.42, 10);
  });

  it("skips blank lines and zero rows", () => {
    const rows = parseCursorCsv(
      [CSV_HEADER, "", "2026-09-07T01:02:00Z,,10,10,0,5,15,$0.1,$0.1", ""].join(
        "\n",
      ),
    );
    expect(rows).toEqual([]);
  });

  it("throws a skippable error on a renamed export header", () => {
    expect(() =>
      parseCursorCsv(
        [
          "Date,Model,Kind,Input Tokens,Output",
          "2026-09-07T01:02:00Z,test-model,Included,10,20",
        ].join("\n"),
      ),
    ).toThrow(/header unrecognized/);
  });

  it("groups instants by the account calendar, not the process zone", () => {
    // 2026-09-07T16:30Z is 2026-09-08 00:30 in Asia/Shanghai (UTC+8).
    const rows = parseCursorCsv(
      [
        CSV_HEADER,
        "2026-09-07T16:30:00Z,test-model,100,100,0,10,110,$0.1,$0.1",
      ].join("\n"),
    );
    const bucket = (zone: string) =>
      aggregateCursorUsage(rows, createCalendar(zone)).map(
        ({ date, hourStart }) => [date, hourStart],
      );
    expect(bucket("Asia/Shanghai")).toEqual([
      ["2026-09-08", "2026-09-07T16:00:00.000Z"],
    ]);
    expect(bucket("America/New_York")).toEqual([
      ["2026-09-07", "2026-09-07T16:00:00.000Z"],
    ]);
  });

  it("keeps date-only rows as their whole day in any calendar", () => {
    const rows = parseCursorCsv(
      [CSV_HEADER, "2026-09-07,test-model,100,100,0,10,110,$0.1,$0.1"].join(
        "\n",
      ),
    );
    for (const zone of ["Asia/Shanghai", "America/Los_Angeles", "UTC"]) {
      const buckets = aggregateCursorUsage(rows, createCalendar(zone));
      expect(buckets.map(({ date, hourStart }) => [date, hourStart])).toEqual([
        ["2026-09-07", undefined],
      ]);
    }
  });
});

describe("resolveCursorFetchTimeout", () => {
  it("defaults invalid values to 120s and accepts positives", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "Infinity"]) {
      expect(resolveCursorFetchTimeout(value)).toBe(120_000);
    }
    expect(resolveCursorFetchTimeout("45000")).toBe(45_000);
  });
});

describe("collectCursorUsage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "myccusage-cursor-test-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips quietly when the state DB is missing", async () => {
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", join(dir, "missing.vscdb"));
    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(true);
    expect(result.buckets).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it("skips quietly when no session token is stored", async () => {
    const dbPath = join(dir, "state.vscdb");
    const db = openDb(dbPath);
    try {
      db.exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`);
    } finally {
      db.close();
    }
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);
    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(true);
    expect(result.warnings[0]).toMatch(/session token/);
  });

  it("sends the sub-scoped cookie first and aggregates the export", async () => {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);

    const cookies: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { headers?: Record<string, string> }) => {
        cookies.push(init?.headers?.["Cookie"] ?? null);
        return new Response(
          [
            CSV_HEADER,
            '2026-09-07T01:02:00Z,test-model,10,20,30,40,100,"$1.21","$0.50"',
          ].join("\n"),
        );
      }),
    );

    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(cookies[0]).toBe(
      `WorkosCursorSessionToken=auth0|cursor-test-user%3A%3A${TOKEN}`,
    );
    expect(result.buckets).toEqual([
      {
        date: "2026-09-07",
        hourStart: "2026-09-07T01:00:00.000Z",
        model: "test-model",
        inputTokens: 20,
        outputTokens: 40,
        // Cache writes are max(0, 10 - 20)
        cacheCreationTokens: 0,
        cacheReadTokens: 30,
        cost: 1.21,
        requests: 1,
      },
    ]);
  });

  it("throws a re-login error only after every credential variant fails", async () => {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);

    const fetchMock = vi.fn(
      async () => new Response("", { status: 401, statusText: "Unauthorized" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectCursorUsage(SHANGHAI)).rejects.toThrow(/sign in again/);
    // sub cookie + userId cookie + bare token + bearer.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("soft-skips server failures instead of throwing", async () => {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);

    const fetchMock = vi.fn(async () => new Response("", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(true);
    expect(result.buckets).toEqual([]);
    expect(result.warnings[0]).toMatch(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("soft-skips network failures with the underlying code", async () => {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("dns down"), { code: "ENOTFOUND" }),
        });
      }),
    );

    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(true);
    expect(result.warnings[0]).toMatch(/ENOTFOUND/);
    expect(result.warnings[0]).not.toMatch(new RegExp(TOKEN));
  });

  it("skips an empty export instead of uploading nothing", async () => {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(`${CSV_HEADER}\n`)),
    );

    const result = await collectCursorUsage(SHANGHAI);
    expect(result.skipped).toBe(true);
    expect(result.buckets).toEqual([]);
  });
});
