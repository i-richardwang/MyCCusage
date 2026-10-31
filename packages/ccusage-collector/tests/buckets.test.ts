import { describe, expect, it } from "vitest";
import { dailyBuckets } from "../src/buckets";
import type { DailyUsageRecord } from "../src/types";

const day = (overrides: Partial<DailyUsageRecord>): DailyUsageRecord => ({
  date: "2026-10-29",
  inputTokens: 100,
  outputTokens: 50,
  cacheCreationTokens: 20,
  cacheReadTokens: 400,
  totalCost: 1,
  modelBreakdowns: [],
  ...overrides,
});

const breakdown = (modelName: string, share: number) => ({
  modelName,
  inputTokens: 100 * share,
  outputTokens: 50 * share,
  cacheCreationTokens: 20 * share,
  cacheReadTokens: 400 * share,
  cost: share,
});

describe("dailyBuckets", () => {
  it("splits a day by its model breakdowns", () => {
    const buckets = dailyBuckets([
      day({ modelBreakdowns: [breakdown("a", 0.75), breakdown("b", 0.25)] }),
    ]);
    expect(buckets.map(({ model, inputTokens, cost }) => [model, inputTokens, cost]))
      .toEqual([
        ["a", 75, 0.75],
        ["b", 25, 0.25],
      ]);
  });

  it("keeps usage the breakdowns do not attribute under an empty model", () => {
    const buckets = dailyBuckets([
      day({ modelBreakdowns: [breakdown("a", 0.5), breakdown("a", 0.25)] }),
    ]);
    expect(buckets).toEqual([
      expect.objectContaining({ model: "a", inputTokens: 75, cost: 0.75 }),
      expect.objectContaining({
        model: "",
        inputTokens: 25,
        cacheReadTokens: 100,
        cost: 0.25,
      }),
    ]);
  });

  it("keeps a day whole when its breakdowns exceed its totals", () => {
    expect(
      dailyBuckets([day({ modelBreakdowns: [breakdown("a", 2)] })]),
    ).toEqual([
      {
        date: "2026-10-29",
        model: "",
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 20,
        cacheReadTokens: 400,
        cost: 1,
      },
    ]);
  });

  it("ignores floating-point cost drift", () => {
    const buckets = dailyBuckets([
      day({
        totalCost: 0.3,
        modelBreakdowns: [
          { ...breakdown("a", 0.5), cost: 0.1 },
          { ...breakdown("b", 0.5), cost: 0.2 },
        ],
      }),
    ]);
    expect(buckets.map(({ model }) => model)).toEqual(["a", "b"]);
  });
});
