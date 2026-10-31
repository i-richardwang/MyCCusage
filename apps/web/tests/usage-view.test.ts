import { describe, expect, it } from "vitest";
import { hoursIn } from "@/lib/day-range";
import { selectUsage } from "@/lib/usage-view";
import type { HourlyRecord, UsageRecord } from "@/types/chart-types";

const metrics = (tokens: number, cost: number) => ({
  totalTokens: tokens,
  totalCost: cost,
  inputTokens: tokens,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
});

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
  ...metrics(tokens, tokens / 100),
  ...overrides,
});

const hour = (
  hourStart: string,
  date: string,
  tokens: number,
): HourlyRecord => ({
  hourStart,
  date,
  agentType: "claude-code",
  ...metrics(tokens, tokens / 100),
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
    }),
    record("2026-10-30", "claude-haiku-5-5", 300, { requests: 2 }),
    record("2026-10-30", "gpt-5", 1000, { agentType: "codex" }),
  ];
  const hourly = [
    hour("2026-10-30T01:00:00.000Z", "2026-10-30", 900),
    {
      ...hour("2026-10-30T02:00:00.000Z", "2026-10-30", 1000),
      agentType: "codex" as const,
    },
  ];
  const account = { records, hourly, timezone: "Asia/Shanghai" };

  it("ranks models and counts requests and reasoning where reported", () => {
    const view = selectUsage(account, "claude-code", {
      from: "2026-10-29",
      to: "2026-10-30",
    });
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
    expect(view.hourly?.records).toEqual([hourly[0]]);
  });

  it("keeps billed days and models when the source reports cost without tokens", () => {
    const billed = record("2026-10-30", "billed-model", 0, { totalCost: 2 });
    const view = selectUsage(
      { ...account, records: [billed], hourly: [] },
      "all",
      {
        from: "2026-10-30",
        to: "2026-10-30",
      },
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

  it("leaves hours out of ranges too long to show them", () => {
    const view = selectUsage(account, "all", {
      from: "2026-01-01",
      to: "2026-10-30",
    });
    expect(view.hourly).toBeNull();
    expect(view.summary.hourlyCoverage).toBeCloseTo(1900 / 2000);
  });
});
