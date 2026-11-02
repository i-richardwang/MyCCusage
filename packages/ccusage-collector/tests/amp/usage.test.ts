import { describe, expect, it } from "vitest";
import { aggregateAmpUsage, apportion } from "../../src/amp/usage";
import { createCalendar, type Calendar } from "../../src/calendar";
import { NO_COST } from "../../src/pricing/rates";
import type { UsageBucket } from "../../src/types";
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
  tokenTotal,
} from "./fixtures";

const hourOf = (b: UsageBucket) => b.hourStart;
const byModel = (buckets: UsageBucket[]) =>
  Object.fromEntries(buckets.map((b) => [b.model, b]));

const unpricedModels = (buckets: UsageBucket[]) =>
  buckets.filter((b) => b.unpricedTokens > 0).map((b) => b.model);

describe("apportion", () => {
  it("splits a total by weight into integers that add up exactly", () => {
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(7, [0, 5, 2])).toEqual([0, 5, 2]);
    expect(apportion(1, [3, 3])).toEqual([1, 0]);
    expect(apportion(0, [1, 2])).toEqual([0, 0]);
  });

  it("gives everything to the first share when nothing carries weight", () => {
    expect(apportion(5, [0, 0])).toEqual([5, 0]);
  });
});

describe("aggregateAmpUsage", () => {
  it("places the main agent's requests in their hours, falling back to thread creation", () => {
    const tokens = (n: number) => ({
      inputTokens: n,
      outputTokens: n,
      cacheCreationTokens: n,
      cacheReadTokens: n,
    });
    const buckets = aggregateAmpUsage(
      [
        cachedThread({
          id: "T-1",
          created: Date.parse(at("2026-10-20", 12)),
          usage: [
            usageEntry("claude-a", tokens(1)),
            { ...usageEntry("claude-a", tokens(2)), timestamp: at(DAY, 13) },
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

    expect(
      buckets.map((b) => [
        b.date,
        hourOf(b),
        b.model,
        b.requests,
        b.inputTokens,
      ]),
    ).toEqual([
      ["2026-10-20", at("2026-10-20", 12), "claude-b", 1, 5],
      [DAY, at(DAY, 12), "claude-a", 1, 1],
      [DAY, at(DAY, 13), "claude-a", 1, 2],
      ["2026-10-22", at("2026-10-22", 10), "claude-b", 1, 3],
    ]);
    expect(buckets.every((b) => b.cost === 0)).toBe(true);
    expect(buckets[0]).not.toHaveProperty("reasoningTokens");
  });

  it("treats cache creation as uncached input for non-Anthropic models", () => {
    const tokens = {
      outputTokens: 1,
      cacheCreationTokens: 100,
      cacheReadTokens: 10,
    };
    const buckets = aggregateAmpUsage(
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
    const models = byModel(buckets);
    expect(models["gpt-6.1-sol"]).toMatchObject({
      inputTokens: 100,
      cacheCreationTokens: 0,
    });
    expect(models["claude-opus-5-5"]).toMatchObject({
      inputTokens: 0,
      cacheCreationTokens: 100,
    });
    expect(tokenTotal(buckets)).toBe(222);
  });

  it("names export models without their provider prefix", () => {
    const buckets = aggregateAmpUsage(
      [
        cachedThread({
          id: "T-1",
          usage: [usageEntry("meta/muse-spark-1.3", { outputTokens: 1 })],
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
    expect(buckets.map((b) => b.model)).toEqual(["muse-spark-1.3"]);
  });

  it("adds subagent usage from the day report and reuses its model names", () => {
    const agent = usageEntry("deepseek-flash", {
      outputTokens: 10,
      cacheCreationTokens: 20,
      cacheReadTokens: 80,
    });
    const unreconciled: string[] = [];
    const buckets = aggregateAmpUsage(
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
    expect(buckets).toEqual([
      {
        date: DAY,
        hourStart: NOON,
        model: "deepseek-v4.1-flash",
        // T-1 from the report (165 tokens, 2 requests) + T-2 from the export
        // (110 tokens, 1 request)
        requests: 2 + 1,
        inputTokens: 30 + 20,
        outputTokens: 15 + 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 120 + 80,
        // The test prices no DeepSeek model
        ...NO_COST,
        unpricedTokens: 275,
      },
    ]);
  });

  it("spreads subagent usage over the hours of the main agent's tokens", () => {
    const buckets = aggregateAmpUsage(
      [
        cachedThread({
          id: "T-1",
          usage: [
            // 100 tokens at 09:00, 300 at 10:00: subagents split 1:3
            {
              ...usageEntry("deepseek-flash", {
                inputTokens: 20,
                cacheReadTokens: 80,
              }),
              timestamp: at(DAY, 9),
            },
            {
              ...usageEntry("deepseek-flash", {
                outputTokens: 10,
                cacheReadTokens: 290,
              }),
              timestamp: at(DAY, 10),
            },
          ],
          reports: {
            [DAY_KEY]: {
              fetchedAt: NOON,
              report: {
                inputTokens: 990,
                cacheReadTokens: 870,
                outputTokens: 50,
                models: [
                  {
                    name: "DeepSeek V4.1 Flash",
                    requests: 6,
                    inputTokens: 990,
                    outputTokens: 50,
                  },
                ],
                routing: [
                  {
                    modelId: "deepseek/deepseek-v4.1-flash",
                    purpose: "Agent",
                    requests: 2,
                  },
                  {
                    modelId: "deepseek/deepseek-v4.1-flash",
                    purpose: "Task",
                    requests: 4,
                  },
                ],
              },
            },
          },
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
    // Subagents: 4 requests, 600 input of which 500 cache reads, 40 output
    expect(buckets).toEqual([
      {
        date: DAY,
        hourStart: at(DAY, 9),
        model: "deepseek-v4.1-flash",
        requests: 1 + 1,
        inputTokens: 20 + 25,
        outputTokens: 0 + 10,
        cacheCreationTokens: 0,
        cacheReadTokens: 80 + 125,
        ...NO_COST,
        unpricedTokens: 260,
      },
      {
        date: DAY,
        hourStart: at(DAY, 10),
        model: "deepseek-v4.1-flash",
        requests: 1 + 3,
        inputTokens: 0 + 75,
        outputTokens: 10 + 30,
        cacheCreationTokens: 0,
        cacheReadTokens: 290 + 375,
        ...NO_COST,
        unpricedTokens: 780,
      },
    ]);
    expect(tokenTotal(buckets)).toBe(990 + 50);
  });

  it("places a model only subagents used by the thread's other requests, then its messages", () => {
    const report = {
      inputTokens: 300,
      cacheReadTokens: 0,
      outputTokens: 40,
      models: [
        { name: "Opus 5.5", requests: 1, inputTokens: 100, outputTokens: 10 },
        { name: "Haiku 5.5", requests: 3, inputTokens: 200, outputTokens: 30 },
      ],
      routing: [
        { modelId: "anthropic/claude-opus-5-5", purpose: "Agent", requests: 1 },
        {
          modelId: "anthropic/claude-haiku-5-5",
          purpose: "Thread Title",
          requests: 3,
        },
      ],
    };
    const agent = {
      ...usageEntry("claude-opus-5-5", { inputTokens: 100, outputTokens: 10 }),
      timestamp: at(DAY, 9),
    };
    const reports = { [DAY_KEY]: { fetchedAt: NOON, report } };

    const buckets = aggregateAmpUsage(
      [cachedThread({ id: "T-1", usage: [agent], reports })],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
    expect(buckets.map((b) => [hourOf(b), b.model, b.requests])).toEqual([
      [at(DAY, 9), "claude-haiku-5-5", 3],
      [at(DAY, 9), "claude-opus-5-5", 1],
    ]);

    // Without a usage entry that day, the thread's messages weigh the hours
    const byMessages = aggregateAmpUsage(
      [
        cachedThread({
          id: "T-1",
          activity: [at(DAY, 8), at(DAY, 8), at(DAY, 11)],
          reports: {
            [DAY_KEY]: {
              fetchedAt: NOON,
              report: {
                ...report,
                inputTokens: 200,
                outputTokens: 30,
                models: [report.models[1]!],
                routing: [report.routing[1]!],
              },
            },
          },
        }),
      ],
      { calendar: CALENDAR, pricing: UNPRICED },
    );
    expect(
      byMessages.map((b) => [
        hourOf(b),
        b.requests,
        b.inputTokens,
        b.outputTokens,
      ]),
    ).toEqual([
      [at(DAY, 8), 2, 133, 20],
      [at(DAY, 11), 1, 67, 10],
    ]);
  });

  it("reports days whose report could not be used", () => {
    const unreconciled: string[] = [];
    const buckets = aggregateAmpUsage(
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
    expect(tokenTotal(buckets)).toBe(5);
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
    const buckets = aggregateAmpUsage(threads, { calendar: CALENDAR, pricing });
    // Combined main + subagent: input 50, output 25, reads 200; no duplicate main usage.
    expect(buckets.map((b) => b.cost)).toEqual([120, 0]);
    expect(unpricedModels(buckets)).toEqual(["unknown"]);
    expect(tokenTotal(buckets)).toBe(282);
    // Pricing and repeated aggregation do not mutate the cached thread data.
    expect(aggregateAmpUsage(threads, { calendar: CALENDAR, pricing })).toEqual(
      buckets,
    );
    expect(
      aggregateAmpUsage(threads, {
        calendar: CALENDAR,
        pricing: UNPRICED,
      }).map((b) => b.cost),
    ).toEqual([0, 0]);
    // The reconciled export name is a safe fallback when only that name has
    // a price; a different model version is never inferred from its spelling.
    const aliased = aggregateAmpUsage(threads, {
      calendar: CALENDAR,
      pricing: {
        ...pricing,
        models: { "deepseek-flash": pricing.models["deepseek-v4.1-flash"] },
      },
    });
    expect(aliased.map((b) => b.cost)).toEqual([120, 0]);
    expect(unpricedModels(aliased)).toEqual(["unknown"]);
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
    const buckets = aggregateAmpUsage(threads, { calendar: CALENDAR, pricing });
    expect(buckets.map((b) => [b.model, b.cost])).toEqual([
      ["claude-test", 340],
      ["gpt-test", 140],
    ]);
    expect(unpricedModels(buckets)).toEqual([]);
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
    const repriced = aggregateAmpUsage(threads, {
      calendar: CALENDAR,
      pricing: doubled,
    });
    expect(repriced.map((b) => b.cost)).toEqual([680, 280]);
    expect(tokenTotal(repriced)).toBe(tokenTotal(buckets));
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
      aggregateAmpUsage([thread], {
        calendar,
        pricing: UNPRICED,
        onUnreconciled: (id) => unreconciled.push(id),
      }).map((b) => [b.date, hourOf(b), tokenTotal([b])]);
    // Main agent + subagents from the report
    expect(total(CALENDAR)).toEqual([[DAY, NOON, 165]]);
    // Another calendar's day has no report yet: main agent only, and not
    // reported as unreconcilable
    expect(total(newYork)).toEqual([[DAY, NOON, 110]]);
    expect(unreconciled).toEqual([]);
  });
});
