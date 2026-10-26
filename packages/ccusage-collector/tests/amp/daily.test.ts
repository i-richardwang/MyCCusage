import { describe, expect, it } from "vitest";
import { aggregateAmpDaily } from "../../src/amp/daily";
import type { AmpDayReport } from "../../src/amp/report";
import { DAY, NOON, cachedThread, usageEntry } from "./fixtures";

describe("aggregateAmpDaily", () => {
  it("sums export usage per local day and model, falling back to thread creation", () => {
    const tokens = (n: number) => ({
      inputTokens: n,
      outputTokens: n,
      cacheCreationTokens: n,
      cacheReadTokens: n,
    });
    const daily = aggregateAmpDaily([
      cachedThread({
        id: "T-1",
        created: new Date(2026, 9, 20, 12).getTime(),
        usage: [
          usageEntry("claude-a", tokens(1)),
          usageEntry("claude-a", tokens(2)),
          { ...usageEntry("claude-b", tokens(5)), timestamp: null },
        ],
      }),
      cachedThread({
        id: "T-2",
        usage: [
          {
            ...usageEntry("claude-b", tokens(3)),
            timestamp: new Date(2026, 9, 22, 10).toISOString(),
          },
        ],
      }),
    ]);

    expect(daily.map((d) => d.date)).toEqual(["2026-10-20", DAY, "2026-10-22"]);
    const oct21 = daily[1]!;
    expect(oct21.modelsUsed).toEqual(["claude-a"]);
    expect(oct21.inputTokens).toBe(3);
    expect(oct21.totalTokens).toBe(12);
    expect(oct21.totalCost).toBe(0);
  });

  it("treats cache creation as uncached input for non-Anthropic models", () => {
    const tokens = { outputTokens: 1, cacheCreationTokens: 100, cacheReadTokens: 10 };
    const [day] = aggregateAmpDaily([
      cachedThread({
        id: "T-1",
        usage: [usageEntry("gpt-6.1-sol", tokens), usageEntry("claude-opus-5-5", tokens)],
      }),
    ]);
    const byModel = Object.fromEntries(
      day!.modelBreakdowns.map((m) => [m.modelName, m]),
    );
    expect(byModel["gpt-6.1-sol"]).toMatchObject({
      inputTokens: 100,
      cacheCreationTokens: 0,
    });
    expect(byModel["claude-opus-5-5"]).toMatchObject({
      inputTokens: 0,
      cacheCreationTokens: 100,
    });
    expect(day!.totalTokens).toBe(222);
  });

  it("names export models without their provider prefix", () => {
    const [day] = aggregateAmpDaily([
      cachedThread({
        id: "T-1",
        usage: [usageEntry("meta/muse-spark-1.3", { outputTokens: 1 })],
      }),
    ]);
    expect(day!.modelsUsed).toEqual(["muse-spark-1.3"]);
  });

  it("adds subagent usage from the day report and reuses its model names", () => {
    const agent = usageEntry("deepseek-flash", {
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
    });
    const report: AmpDayReport = {
      inputTokens: 150,
      cacheReadTokens: 120,
      outputTokens: 15,
      models: [{ name: "DeepSeek V4.1 Flash", requests: 2, inputTokens: 150, outputTokens: 15 }],
      routing: [
        { modelId: "deepseek/deepseek-v4.1-flash", purpose: "Agent", requests: 1 },
        { modelId: "deepseek/deepseek-v4.1-flash", purpose: "Read Thread", requests: 1 },
      ],
    };
    const unreconciled: string[] = [];
    const daily = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          usage: [agent],
          reports: { [DAY]: { fetchedAt: NOON, report } },
        }),
        // No report yet: main agent only, under the learned report name
        cachedThread({ id: "T-2", usage: [agent] }),
      ],
      (threadId) => unreconciled.push(threadId),
    );

    expect(unreconciled).toEqual([]);
    expect(daily).toHaveLength(1);
    expect(daily[0]!.modelBreakdowns).toEqual([
      {
        modelName: "deepseek-v4.1-flash",
        // T-1 from the report (165 tokens) + T-2 from the export (110 tokens)
        inputTokens: 30 + 20,
        outputTokens: 15 + 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 120 + 80,
        cost: 0,
      },
    ]);
  });

  it("reports days whose report could not be used", () => {
    const unreconciled: string[] = [];
    const daily = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          usage: [usageEntry("claude-a", { outputTokens: 5 })],
          reports: { [DAY]: { fetchedAt: NOON, report: null } },
        }),
      ],
      (threadId, date) => unreconciled.push(`${threadId} ${date}`),
    );
    expect(unreconciled).toEqual([`T-1 ${DAY}`]);
    expect(daily[0]!.totalTokens).toBe(5);
  });
});
