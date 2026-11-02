import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateCursorUsage,
  collectCursorUsage,
  dedupePages,
  parseUsageEvent,
  parseUsagePage,
  resolveCursorFetchTimeout,
  type CursorUsageEvent,
} from "../src/cursor";
import { NO_COST, type PricingTable } from "../src/pricing/rates";
import { createCalendar } from "../src/calendar";

const SHANGHAI = createCalendar("Asia/Shanghai");

const TOKEN =
  `header.` +
  Buffer.from(JSON.stringify({ sub: "auth0|cursor-test-user" })).toString(
    "base64url",
  ) +
  `.test-signature`;

// The sync runs at this instant; its 30-day window starts on 2026-08-09
const NOW = new Date("2026-09-07T10:00:00Z");
const WINDOW: [number, number] = [0, NOW.getTime()];

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

// One usage event as the dashboard endpoint returns it
function event(
  at: string,
  model: string,
  tokenUsage: Record<string, number> | null = {
    inputTokens: 100,
    outputTokens: 40,
    cacheReadTokens: 30,
    cacheWriteTokens: 10,
    totalCents: 10,
  },
) {
  return {
    timestamp: String(Date.parse(at)),
    model,
    kind: "USAGE_EVENT_KIND_USAGE_BASED",
    conversationId: "c-1",
    tokenUsage,
  };
}

const page = (events: unknown[], total = events.length) =>
  JSON.stringify({ totalUsageEventsCount: total, usageEventsDisplay: events });

const PRICING: PricingTable = {
  asOf: "2026-09-01T00:00:00.000Z",
  models: { "cheap-model": { input: 1e-6, output: 3e-6 } },
};

describe("parseUsageEvent", () => {
  it("reads one request with Cursor's cache split and list-price cost", () => {
    const parsed = parseUsageEvent(
      event("2026-09-07T01:02:00Z", "cheap-model"),
      WINDOW,
    );
    expect(parsed).toEqual({
      instant: new Date("2026-09-07T01:02:00Z"),
      model: "cheap-model",
      inputTokens: 100,
      outputTokens: 40,
      cacheCreationTokens: 10,
      cacheReadTokens: 30,
      reportedCost: 0.1,
    });
  });

  it("accepts a numeric timestamp and drops events without usage", () => {
    const numeric = { ...event("2026-09-07T01:02:00Z", "m"), timestamp: 1 };
    expect(parseUsageEvent(numeric, WINDOW)?.instant.getTime()).toBe(1);
    expect(
      parseUsageEvent(event("2026-09-07T01:02:00Z", "m", null), WINDOW),
    ).toBeNull();
    expect(
      parseUsageEvent(event("2026-09-07T01:02:00Z", "m", {}), WINDOW),
    ).toBeNull();
  });

  it("keeps only events in the window", () => {
    const late = event("2026-09-07T10:00:01Z", "m");
    expect(parseUsageEvent(late, WINDOW)).toBeNull();
    expect(
      parseUsageEvent(late, [0, Date.parse("2026-09-08T00:00:00Z")]),
    ).not.toBeNull();
  });

  it("throws a skip on an event it does not understand", () => {
    expect(() =>
      parseUsageEvent(
        { ...event("2026-09-07T01:02:00Z", "m"), model: "" },
        WINDOW,
      ),
    ).toThrow(/unrecognized/);
    expect(() =>
      parseUsageEvent(
        event("2026-09-07T01:02:00Z", "m", { inputTokens: -1 }),
        WINDOW,
      ),
    ).toThrow(/invalid totals/);
    expect(() => parseUsageEvent("row", WINDOW)).toThrow(/unrecognized/);
  });
});

describe("parseUsagePage", () => {
  it("reads events and their count, and an empty window", () => {
    expect(
      parseUsagePage({ totalUsageEventsCount: 2, usageEventsDisplay: [1, 2] }),
    ).toEqual({ events: [1, 2], total: 2 });
    expect(parseUsagePage({})).toEqual({ events: [] });
    expect(parseUsagePage({ totalUsageEventsCount: 0 })).toEqual({
      events: [],
      total: 0,
    });
  });

  it("throws a skip on errors and unknown shapes", () => {
    expect(() => parseUsagePage({ error: "nope" })).toThrow(/error response/);
    expect(() => parseUsagePage({ usageEventsDisplay: "x" })).toThrow(
      /unrecognized/,
    );
    expect(() => parseUsagePage([])).toThrow(/not an object/);
  });
});

describe("dedupePages", () => {
  it("drops the events a later page repeats from the one before", () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const c = { id: "c" };
    // An event arrived between the two reads and pushed b onto page 2
    expect(
      dedupePages(
        [
          [a, b],
          [{ ...b }, c],
        ],
        3,
      ),
    ).toEqual([a, b, c]);
    expect(dedupePages([[a, b], [c]])).toEqual([a, b, c]);
  });

  it("throws a skip when the pages do not add up to the count", () => {
    expect(() => dedupePages([[{ id: "a" }]], 2)).toThrow(/1 of 2/);
    expect(() => dedupePages([[{ id: "a" }], [{ id: "b" }]], 1)).toThrow(
      /add up/,
    );
  });
});

describe("aggregateCursorUsage", () => {
  const request = (at: string, model: string, n: number): CursorUsageEvent => ({
    instant: new Date(at),
    model,
    inputTokens: n,
    outputTokens: n,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reportedCost: n / 100,
  });

  it("sums requests into account-calendar hours per model", () => {
    const buckets = aggregateCursorUsage(
      [
        request("2026-09-07T01:02:00Z", "cheap-model", 10),
        request("2026-09-07T01:40:00Z", "cheap-model", 1),
        request("2026-09-07T02:00:00Z", "pricey-model", 1),
        request("2026-09-08T01:00:00Z", "cheap-model", 5),
      ],
      SHANGHAI,
      PRICING,
    );
    expect(
      buckets.map(({ date, hourStart, model, requests, inputTokens }) => [
        date,
        hourStart,
        model,
        requests,
        inputTokens,
      ]),
    ).toEqual([
      ["2026-09-07", "2026-09-07T01:00:00.000Z", "cheap-model", 2, 11],
      ["2026-09-07", "2026-09-07T02:00:00.000Z", "pricey-model", 1, 1],
      ["2026-09-08", "2026-09-08T01:00:00.000Z", "cheap-model", 1, 5],
    ]);
    expect(buckets[0]?.cost).toBeCloseTo(0.11, 10);
    expect(buckets[0]).not.toHaveProperty("reasoningTokens");
  });

  it("splits Cursor's charge by list rates where the model has them", () => {
    const [cheap, pricey] = aggregateCursorUsage(
      [
        request("2026-09-07T01:02:00Z", "cheap-model", 10),
        request("2026-09-07T02:00:00Z", "pricey-model", 10),
      ],
      SHANGHAI,
      PRICING,
    );
    // Input and output at 1:3 list rates share Cursor's $0.10 as 1:3
    expect(cheap).toMatchObject({
      cost: 0.1,
      inputCost: expect.closeTo(0.025, 12),
      outputCost: expect.closeTo(0.075, 12),
      unpricedTokens: 0,
    });
    expect(pricey).toMatchObject({
      cost: 0.1,
      inputCost: 0,
      outputCost: 0,
      unpricedTokens: 0,
    });
  });

  it("groups instants by the account calendar, not the process zone", () => {
    // 2026-09-07T16:30Z is 2026-09-08 00:30 in Asia/Shanghai (UTC+8).
    const requests = [request("2026-09-07T16:30:00Z", "m", 1)];
    const bucket = (zone: string) =>
      aggregateCursorUsage(requests, createCalendar(zone), PRICING).map(
        ({ date, hourStart }) => [date, hourStart],
      );
    expect(bucket("Asia/Shanghai")).toEqual([
      ["2026-09-08", "2026-09-07T16:00:00.000Z"],
    ]);
    expect(bucket("America/New_York")).toEqual([
      ["2026-09-07", "2026-09-07T16:00:00.000Z"],
    ]);
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

  function seed() {
    const dbPath = join(dir, "state.vscdb");
    seedTokenDb(dbPath);
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", dbPath);
  }

  interface Call {
    body: {
      page: number;
      pageSize: number;
      startDate: string;
      endDate: string;
    };
    headers: Record<string, string>;
  }

  function stubFetch(respond: (call: Call) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const mock = vi.fn(
      async (
        _url: unknown,
        init?: { body?: string; headers?: Record<string, string> },
      ) => {
        const call = {
          body: JSON.parse(init?.body ?? "{}"),
          headers: init?.headers ?? {},
        };
        calls.push(call);
        return respond(call);
      },
    );
    vi.stubGlobal("fetch", mock);
    return calls;
  }

  it("skips quietly when the state DB is missing", async () => {
    vi.stubEnv("MYCCUSAGE_CURSOR_DB", join(dir, "missing.vscdb"));
    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
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
    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(true);
    expect(result.warnings[0]).toMatch(/session token/);
  });

  it("asks for the last 30 days with the sub-scoped cookie and states them completely", async () => {
    seed();
    const calls = stubFetch(
      () => new Response(page([event("2026-09-07T01:02:00Z", "test-model")])),
    );

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["Cookie"]).toBe(
      `WorkosCursorSessionToken=auth0|cursor-test-user%3A%3A${TOKEN}`,
    );
    expect(calls[0]!.body).toEqual({
      page: 1,
      pageSize: 1000,
      // 2026-08-09 00:00 in Shanghai
      startDate: String(Date.parse("2026-08-08T16:00:00Z")),
      endDate: String(NOW.getTime()),
    });
    expect(result.buckets).toEqual([
      {
        date: "2026-09-07",
        hourStart: "2026-09-07T01:00:00.000Z",
        model: "test-model",
        inputTokens: 100,
        outputTokens: 40,
        cacheCreationTokens: 10,
        cacheReadTokens: 30,
        ...NO_COST,
        // test-model has no list rates, so the charge stays unsplit
        cost: 0.1,
        requests: 1,
      },
    ]);
    expect(result.range).toEqual({ from: "2026-09-07", to: "2026-09-07" });
  });

  it("reads every event on a full-history run, stating only the recent days completely", async () => {
    seed();
    const calls = stubFetch(
      () =>
        new Response(
          page([
            event("2026-09-01T01:02:00Z", "test-model"),
            event("2026-07-01T01:02:00Z", "test-model"),
          ]),
        ),
    );

    const result = await collectCursorUsage(SHANGHAI, PRICING, {
      now: NOW,
      fullHistory: true,
    });
    expect(calls[0]!.body.startDate).toBe("0");
    expect(result.buckets.map((b) => b.date)).toEqual([
      "2026-07-01",
      "2026-09-01",
    ]);
    expect(result.range).toEqual({ from: "2026-09-01", to: "2026-09-07" });
  });

  it("pages through the window and drops events repeated across a boundary", async () => {
    seed();
    const events = Array.from({ length: 1000 }, (_, i) =>
      event(
        new Date(Date.parse("2026-09-07T00:00:00Z") + i * 1000).toISOString(),
        "m",
      ),
    );
    const newest = event("2026-09-07T05:00:00Z", "m");
    // The second page repeats the first page's last event, which a new event
    // pushed over the boundary
    const pages = [events, [events[999], newest]];
    const calls = stubFetch(({ body, headers }) => {
      if (!headers["Cookie"]) return new Response("", { status: 401 });
      return new Response(page(pages[body.page - 1]!, 1001));
    });

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(calls.map((c) => c.body.page)).toEqual([1, 2]);
    expect(result.buckets.reduce((sum, b) => sum + b.requests, 0)).toBe(1001);
  });

  it("throws a re-login error only after every credential variant fails", async () => {
    seed();
    const calls = stubFetch(
      () => new Response("", { status: 401, statusText: "Unauthorized" }),
    );

    await expect(
      collectCursorUsage(SHANGHAI, PRICING, { now: NOW }),
    ).rejects.toThrow(/sign in again/);
    // sub cookie + userId cookie + bare token + bearer.
    expect(calls).toHaveLength(4);
  });

  it("soft-skips server failures instead of throwing", async () => {
    seed();
    const calls = stubFetch(() => new Response("", { status: 503 }));

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(true);
    expect(result.buckets).toEqual([]);
    expect(result.warnings[0]).toMatch(/HTTP 503/);
    expect(calls).toHaveLength(1);
  });

  it("soft-skips network failures with the underlying code", async () => {
    seed();
    stubFetch(() => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("dns down"), { code: "ENOTFOUND" }),
      });
    });

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(true);
    expect(result.warnings[0]).toMatch(/ENOTFOUND/);
    expect(result.warnings[0]).not.toMatch(new RegExp(TOKEN));
  });

  it("soft-skips a page it does not understand", async () => {
    seed();
    stubFetch(() => new Response(JSON.stringify({ usageEventsDisplay: "?" })));

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(true);
    expect(result.warnings[0]).toMatch(/unrecognized/);
  });

  it("skips an empty window instead of uploading nothing", async () => {
    seed();
    stubFetch(() => new Response("{}"));

    const result = await collectCursorUsage(SHANGHAI, PRICING, { now: NOW });
    expect(result.skipped).toBe(true);
    expect(result.buckets).toEqual([]);
    expect(result.range).toBeUndefined();
  });
});
