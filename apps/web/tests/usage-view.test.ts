import { describe, expect, it } from "vitest";
import { hoursIn } from "@/lib/day-range";
import {
  byMetric,
  hoursNote,
  modelDaily,
  modelHourly,
  selectUsage,
  showsHours,
  viewResolution,
  type HoursLoad,
} from "@/lib/usage-view";
import type { HourlyRecord, UsageRecord } from "@/types/chart-types";

const metrics = (tokens: number, cost: number) => ({
  totalTokens: tokens,
  totalCost: cost,
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

// Synced without a cost split, as day history and earlier hours are
const NO_SPLIT = {
  inputCost: 0,
  outputCost: 0,
  cacheCreationCost: 0,
  cacheReadCost: 0,
  cacheSavings: 0,
  speedPremium: 0,
  unpricedTokens: 0,
};

const record = (
  date: string,
  model: string,
  tokens: number,
  overrides: Partial<UsageRecord> = {},
): UsageRecord => ({
  date,
  deviceId: "d1",
  agentType: "claude-code",
  model,
  reasoningTokens: null,
  requests: null,
  hourlyTokens: 0,
  ...metrics(tokens, tokens / 100),
  ...NO_SPLIT,
  ...overrides,
});

const hour = (
  hourStart: string,
  date: string,
  tokens: number,
  overrides: Partial<HourlyRecord> = {},
): HourlyRecord => ({
  hourStart,
  date,
  deviceId: "d1",
  agentType: "claude-code",
  model: "claude-opus-5-5",
  ...metrics(tokens, tokens / 100),
  ...overrides,
});

describe("hoursIn", () => {
  it("lists the hours of account days, including DST days", () => {
    const shanghai = hoursIn(
      { from: "2026-10-30", to: "2026-10-30" },
      "Asia/Shanghai",
    );
    expect(shanghai).toHaveLength(24);
    expect(shanghai[0]).toBe("2026-10-29T16:00:00.000Z");
    expect(
      hoursIn({ from: "2026-11-01", to: "2026-11-01" }, "America/New_York"),
    ).toHaveLength(25);
    expect(
      hoursIn({ from: "2026-10-30", to: "2026-10-30" }, "Asia/Kolkata")[0],
    ).toBe("2026-10-29T18:30:00.000Z");
  });
});

describe("selectUsage", () => {
  const records = [
    record("2026-10-29", "", 100),
    record("2026-10-30", "claude-opus-5-5", 600, {
      requests: 4,
      reasoningTokens: 7,
      hourlyTokens: 600,
    }),
    record("2026-10-30", "claude-haiku-5-5", 300, {
      requests: 2,
      hourlyTokens: 300,
    }),
    record("2026-10-30", "gpt-5", 1000, {
      agentType: "codex",
      hourlyTokens: 1000,
    }),
  ];
  const hourly = [
    hour("2026-10-30T01:00:00.000Z", "2026-10-30", 600),
    hour("2026-10-30T01:00:00.000Z", "2026-10-30", 300, {
      model: "claude-haiku-5-5",
      deviceId: "d2",
    }),
    hour("2026-10-30T02:00:00.000Z", "2026-10-30", 1000, {
      agentType: "codex",
      model: "gpt-5",
    }),
  ];
  const account = { records, timezone: "Asia/Shanghai" };
  const loaded: HoursLoad = { status: "loaded", records: hourly };

  it("ranks models and counts requests and reasoning where reported", () => {
    const view = selectUsage(
      account,
      "claude-code",
      { from: "2026-10-29", to: "2026-10-30" },
      loaded,
    );
    expect(
      view.models.map(({ model, requests, reasoningTokens, costShare }) => [
        model,
        requests,
        reasoningTokens,
        costShare,
      ]),
    ).toEqual([
      ["claude-opus-5-5", 4, 7, 0.6],
      ["claude-haiku-5-5", 2, null, 0.3],
      ["", null, null, expect.closeTo(0.1)],
    ]);
    expect(view.summary).toMatchObject({
      totalTokens: 1000,
      hourlyCoverage: 0.9,
    });
    expect(view.hourly?.hours).toHaveLength(48);
    expect(view.hourly?.records).toEqual(hourly.slice(0, 2));
  });

  it("keeps each hour's device and model, and gives a model every hour", () => {
    const day = { from: "2026-10-30", to: "2026-10-30" };
    const view = selectUsage(account, "all", day, loaded);
    expect(
      view.hourly?.records.map(({ deviceId, model }) => [deviceId, model]),
    ).toEqual([
      ["d1", "claude-opus-5-5"],
      ["d2", "claude-haiku-5-5"],
      ["d1", "gpt-5"],
    ]);
    const haiku = modelHourly(view, {
      agentType: "claude-code",
      model: "claude-haiku-5-5",
    });
    expect(haiku).toHaveLength(24);
    expect(haiku.filter(({ totalTokens }) => totalTokens > 0)).toEqual([
      expect.objectContaining({
        hourStart: "2026-10-30T01:00:00.000Z",
        totalTokens: 300,
      }),
    ]);
  });

  it("notes hours still loading or failed to load", () => {
    const day = { from: "2026-10-29", to: "2026-10-30" };
    const loading = selectUsage(account, "all", day, { status: "loading" });
    expect(loading.hourly).toMatchObject({ status: "loading", records: [] });
    expect(hoursNote(loading, "hour")).toBe("Loading hours…");
    expect(hoursNote(loading, "day")).toBeNull();
    expect(loading.hourly?.hours).toHaveLength(48);
    const failed = selectUsage(account, "all", day, { status: "failed" });
    expect(hoursNote(failed, "hour")).toMatch(/could not be loaded/);
    expect(
      hoursNote(selectUsage(account, "all", day, loaded), "hour"),
    ).toBeNull();
  });

  it("keeps billed days and models when the source reports cost without tokens", () => {
    const billed = record("2026-10-30", "billed-model", 0, { totalCost: 2 });
    const view = selectUsage(
      { ...account, records: [billed] },
      "all",
      { from: "2026-10-30", to: "2026-10-30" },
      null,
    );
    expect(view.models).toEqual([
      expect.objectContaining({
        model: "billed-model",
        totalCost: 2,
        costShare: 1,
      }),
    ]);
    expect(view.summary).toMatchObject({
      activeDays: 1,
      avgDailyCost: 2,
      totalTokens: 0,
    });
  });

  it("splits the selection by agent and device, and sums reported counts", () => {
    const view = selectUsage(
      {
        ...account,
        records: [
          ...records,
          record("2026-10-30", "gpt-5", 1000, {
            agentType: "codex",
            deviceId: "d2",
          }),
        ],
      },
      "all",
      { from: "2026-10-29", to: "2026-10-30" },
      null,
    );
    expect(
      view.agents.map(({ agentType, tokenShare }) => [agentType, tokenShare]),
    ).toEqual([
      ["codex", 2000 / 3000],
      ["claude-code", 1000 / 3000],
    ]);
    expect(
      view.devices.map(({ deviceId, totalTokens }) => [deviceId, totalTokens]),
    ).toEqual([
      ["d1", 2000],
      ["d2", 1000],
    ]);
    expect(view.summary).toMatchObject({
      activeDays: 2,
      requests: 6,
      reasoningTokens: 7,
    });
  });

  it("counts cache writes as misses in the cache hit rate", () => {
    const cached = record("2026-10-30", "claude-opus-5-5", 100, {
      inputTokens: 10,
      cacheReadTokens: 60,
      cacheCreationTokens: 30,
      totalCost: 2,
    });
    const view = selectUsage(
      { ...account, records: [cached] },
      "all",
      { from: "2026-10-30", to: "2026-10-30" },
      null,
    );
    expect(view.summary.cacheHitRate).toBeCloseTo(0.6);
    expect(view.summary.costPerMillionTokens).toBe(20_000);
    expect(view.models[0]).toMatchObject({
      cacheHitRate: expect.closeTo(0.6),
      costPerMillionTokens: 20_000,
    });

    const empty = selectUsage(
      { ...account, records: [] },
      "all",
      { from: "2026-10-30", to: "2026-10-30" },
      null,
    );
    expect(empty.summary).toMatchObject({
      cacheHitRate: null,
      costPerMillionTokens: null,
      requests: null,
    });
  });

  it("shows hours for ranges of up to 31 days, and covers them from days", () => {
    expect(showsHours({ from: "2026-10-01", to: "2026-10-31" })).toBe(true);
    expect(showsHours({ from: "2026-10-01", to: "2026-11-01" })).toBe(false);
    expect(showsHours({ from: "2026-10-02", to: "2026-10-01" })).toBe(false);
    const year = { from: "2026-01-01", to: "2026-10-30" };
    const view = selectUsage(account, "all", year, null);
    expect(view.hourly).toBeNull();
    expect(view.summary.hourlyCoverage).toBeCloseTo(1900 / 2000);
  });

  it("shows hours for short ranges until days are chosen", () => {
    const day = { from: "2026-10-30", to: "2026-10-30" };
    const week = { from: "2026-10-24", to: "2026-10-30" };
    const year = { from: "2026-01-01", to: "2026-10-30" };
    const today = selectUsage(account, "all", day, loaded);
    expect(viewResolution(today, null)).toBe("hour");
    expect(viewResolution(today, "day")).toBe("day");
    const lastWeek = selectUsage(account, "all", week, loaded);
    expect(viewResolution(lastWeek, null)).toBe("day");
    expect(viewResolution(lastWeek, "hour")).toBe("hour");
    expect(
      viewResolution(selectUsage(account, "all", year, null), "hour"),
    ).toBe("day");
  });

  it("ranks by either metric and gives a model every day of the range", () => {
    const view = selectUsage(
      account,
      "all",
      { from: "2026-10-29", to: "2026-10-30" },
      null,
    );
    const cheapButLarge = { ...view.models[0]!, totalCost: 0, totalTokens: 9e9 };
    expect([view.models[0]!, cheapButLarge].sort(byMetric("tokens"))[0]).toBe(
      cheapButLarge,
    );
    expect(
      modelDaily(view, { agentType: "claude-code", model: "claude-opus-5-5" }),
    ).toEqual([
      expect.objectContaining({ date: "2026-10-29", totalTokens: 0 }),
      expect.objectContaining({ date: "2026-10-30", totalTokens: 600 }),
    ]);
  });

  it("sums the cost split and states the cost and tokens it accounts for", () => {
    const range = { from: "2026-10-30", to: "2026-10-30" };
    const view = selectUsage(
      {
        timezone: "Asia/Shanghai",
        records: [
          // Split in full: $3 of input and output, $1 of it fast premium
          record("2026-10-30", "split", 300, {
            inputCost: 1,
            outputCost: 2,
            cacheSavings: 0.5,
            speedPremium: 1,
          }),
          // Recorded without a split
          record("2026-10-30", "history", 100),
          record("2026-10-30", "unknown", 100, {
            totalCost: 0,
            unpricedTokens: 100,
          }),
        ],
      },
      "all",
      range,
      null,
    );
    expect(view.summary).toMatchObject({
      inputCost: 1,
      outputCost: 2,
      cacheSavings: 0.5,
      speedPremium: 1,
      unpricedTokens: 100,
      splitCoverage: 0.75,
      unpricedShare: 0.2,
      // $4 over the 400 tokens with a price
      costPerMillionTokens: 10_000,
    });
    const models = Object.fromEntries(view.models.map((m) => [m.model, m]));
    expect(models.split).toMatchObject({ splitCoverage: 1, unpricedShare: 0 });
    expect(models.history).toMatchObject({ splitCoverage: 0 });
    expect(models.unknown).toMatchObject({
      splitCoverage: null,
      unpricedShare: 1,
      costPerMillionTokens: null,
    });
  });
});
