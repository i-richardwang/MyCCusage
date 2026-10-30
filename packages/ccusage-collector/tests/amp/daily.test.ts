import { describe, expect, it } from "vitest";
import { aggregateAmpDaily } from "../../src/amp/daily";
import { createCalendar, type Calendar } from "../../src/calendar";
import {
  CALENDAR,
  DAY,
  DAY_KEY,
  NOON,
  at,
  UNPRICED,
  DEEPSEEK_REPORT,
  cachedThread,
  usageEntry,
} from "./fixtures";

describe("aggregateAmpDaily", () => {
  it("sums export usage per day and model, falling back to thread creation", () => {
    const tokens = (n: number) => ({
      inputTokens: n,
      outputTokens: n,
      cacheCreationTokens: n,
      cacheReadTokens: n,
    });
    const daily = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          created: Date.parse(at("2026-10-20", 12)),
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
              timestamp: at("2026-10-22", 10),
            },
          ],
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );

    expect(daily.map((d) => d.date)).toEqual(["2026-10-20", DAY, "2026-10-22"]);
    const oct21 = daily[1]!;
    expect(oct21.modelsUsed).toEqual(["claude-a"]);
    expect(oct21.inputTokens).toBe(3);
    expect(oct21.totalTokens).toBe(12);
    expect(oct21.totalCost).toBe(0);
  });

  it("treats cache creation as uncached input for non-Anthropic models", () => {
    const tokens = {
      outputTokens: 1,
      cacheCreationTokens: 100,
      cacheReadTokens: 10,
    };
    const [day] = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          usage: [
            usageEntry("gpt-6.1-sol", tokens),
            usageEntry("claude-opus-5-5", tokens),
          ],
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
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
    const [day] = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          usage: [usageEntry("meta/muse-spark-1.3", { outputTokens: 1 })],
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
    expect(day!.modelsUsed).toEqual(["muse-spark-1.3"]);
  });

  it("adds subagent usage from the day report and reuses its model names", () => {
    const agent = usageEntry("deepseek-flash", {
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
    });
    const unreconciled: string[] = [];
    const daily = aggregateAmpDaily(
      [
        cachedThread({
          id: "T-1",
          usage: [agent],
          reports: { [DAY_KEY]: { fetchedAt: NOON, report: DEEPSEEK_REPORT } },
        }),
        // No report yet: main agent only, under the learned report name
        cachedThread({ id: "T-2", usage: [agent] }),
      ],
      {
        calendar: CALENDAR,
        pricing: UNPRICED,
        onUnreconciled: (threadId) => unreconciled.push(threadId),
      },
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
          reports: { [DAY_KEY]: { fetchedAt: NOON, report: null } },
        }),
      ],
      {
        calendar: CALENDAR,
        pricing: UNPRICED,
        onUnreconciled: (threadId, date) =>
          unreconciled.push(`${threadId} ${date}`),
      },
    );
    expect(unreconciled).toEqual([`T-1 ${DAY}`]);
    expect(daily[0]!.totalTokens).toBe(5);
  });

  it("prices reconciled agent/subagent usage once, sums across threads, and marks incomplete costs", () => {
    const agent = usageEntry("deepseek-flash", {
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
    });
    const thread = cachedThread({
      id: "T-1",
      usage: [agent],
      reports: {
        [DAY_KEY]: {
          fetchedAt: NOON,
          report: DEEPSEEK_REPORT,
        },
      },
    });
    const unknown = cachedThread({
      id: "T-3",
      usage: [usageEntry("unknown", { outputTokens: 7 })],
    });
    const threads = [
      thread,
      cachedThread({ id: "T-2", usage: [agent] }),
      unknown,
    ];
    const pricing = {
      asOf: NOON,
      models: {
        "deepseek-v4.1-flash": { input: 1, output: 2, cacheRead: 0.1 },
      },
    };
    const [day] = aggregateAmpDaily(threads, { calendar: CALENDAR, pricing });
    // Combined main + subagent: input 50, output 25, reads 200; no duplicate main usage.
    expect(day!.totalCost).toBe(120);
    expect(day!.modelBreakdowns.map((m) => m.cost)).toEqual([120, 0]);
    expect(day!.rawData.costEstimate).toEqual({
      source: "litellm",
      asOf: NOON,
      basis: "base-token-rates",
      unpricedModels: ["unknown"],
      pricingAliases: {},
    });
    expect(day!.totalTokens).toBe(282);
    // Pricing and repeated aggregation do not mutate the cached thread data.
    expect(aggregateAmpDaily(threads, { calendar: CALENDAR, pricing })).toEqual(
      [day],
    );
    expect(
      aggregateAmpDaily(threads, { calendar: CALENDAR, pricing: UNPRICED })[0]!
        .totalCost,
    ).toBe(0);
    // The reconciled export name is a safe fallback when only that name has
    // a price; a different model version is never inferred from its spelling.
    const [aliased] = aggregateAmpDaily(threads, {
      calendar: CALENDAR,
      pricing: {
        ...pricing,
        models: { "deepseek-flash": pricing.models["deepseek-v4.1-flash"] },
      },
    });
    expect(aliased!.totalCost).toBe(120);
    expect(aliased!.rawData.costEstimate.pricingAliases).toEqual({
      "deepseek-v4.1-flash": "deepseek-flash",
    });
  });

  it("prices normalized cache counters and reprices history without changing token totals", () => {
    const threads = [
      cachedThread({
        id: "T-1",
        usage: [
          usageEntry("gpt-test", {
            cacheCreationTokens: 100,
            cacheReadTokens: 200,
            outputTokens: 10,
          }),
          usageEntry("claude-test", {
            cacheCreationTokens: 100,
            cacheReadTokens: 200,
            outputTokens: 10,
          }),
        ],
      }),
    ];
    const prices = { input: 1, output: 2, cacheCreation: 3, cacheRead: 0.1 };
    const pricing = {
      asOf: NOON,
      models: { "gpt-test": prices, "claude-test": prices },
    };
    const [day] = aggregateAmpDaily(threads, { calendar: CALENDAR, pricing });
    expect(day!.modelBreakdowns.map((m) => m.cost)).toEqual([140, 340]);
    expect(day!.totalCost).toBe(480);
    expect(day!.rawData.costEstimate.unpricedModels).toEqual([]);
    const doubled = {
      ...pricing,
      models: {
        "gpt-test": { input: 2, output: 4, cacheCreation: 6, cacheRead: 0.2 },
        "claude-test": {
          input: 2,
          output: 4,
          cacheCreation: 6,
          cacheRead: 0.2,
        },
      },
    };
    const [repriced] = aggregateAmpDaily(threads, {
      calendar: CALENDAR,
      pricing: doubled,
    });
    expect(repriced!.totalCost).toBe(960);
    expect(repriced!.totalTokens).toBe(day!.totalTokens);
  });

  it("uses a report only for the exact range it was fetched for", () => {
    // NOON is 12:00 in Shanghai and 00:00 in New York: DAY in both
    // calendars, but a different range
    const newYork = createCalendar("America/New_York");
    const thread = cachedThread({
      id: "T-1",
      usage: [
        usageEntry("deepseek-flash", {
          outputTokens: 10,
          cacheCreationTokens: 20,
          cacheReadTokens: 80,
        }),
      ],
      reports: { [DAY_KEY]: { fetchedAt: NOON, report: DEEPSEEK_REPORT } },
    });
    const unreconciled: string[] = [];
    const total = (calendar: Calendar) =>
      aggregateAmpDaily([thread], {
        calendar,
        pricing: UNPRICED,
        onUnreconciled: (id) => unreconciled.push(id),
      }).map((d) => [d.date, d.totalTokens]);
    // Main agent + subagents from the report
    expect(total(CALENDAR)).toEqual([[DAY, 165]]);
    // Another calendar's day has no report yet: main agent only, and not
    // reported as unreconcilable
    expect(total(newYork)).toEqual([[DAY, 110]]);
    expect(unreconciled).toEqual([]);
  });
});
