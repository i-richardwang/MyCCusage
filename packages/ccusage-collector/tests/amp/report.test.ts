import { describe, expect, it } from "vitest";
import {
  mergeDayUsage,
  parseThreadUsageReport,
  type AmpDayReport,
} from "../../src/amp/report";
import { MIXED_REPORT, usageEntry } from "./fixtures";

describe("parseThreadUsageReport", () => {
  it("reads totals and both tables by column name", () => {
    const report = parseThreadUsageReport(MIXED_REPORT);
    expect(report).toMatchObject({
      inputTokens: 36_428_492,
      cacheReadTokens: 35_409_330,
      outputTokens: 176_807,
    });
    expect(report.models).toHaveLength(4);
    expect(report.models[1]).toEqual({
      name: "GPT-5.6 Terra",
      requests: 12,
      inputTokens: 481_661,
      outputTokens: 2_791,
    });
    expect(report.routing[3]).toEqual({
      modelId: "anthropic/claude-opus-5-5",
      purpose: "Agent",
      requests: 62,
    });
  });

  it("returns an empty report for a range without usage", () => {
    const report = parseThreadUsageReport(
      "# Thread Usage\n\nNo usage recorded in the selected range.\n",
    );
    expect(report.models).toEqual([]);
    expect(report.inputTokens).toBe(0);
  });

  it("rejects reports whose tables do not add up", () => {
    const broken = MIXED_REPORT.replace("| 62 | 13,223,301 |", "| 62 | 13,000,000 |");
    expect(() => parseThreadUsageReport(broken)).toThrow("do not add up");
  });

  it("rejects text that is not a usage report", () => {
    expect(() => parseThreadUsageReport("Something else")).toThrow();
  });
});

describe("mergeDayUsage", () => {
  it("adds subagent models and skips external-agent (Claude Code) usage", () => {
    const report = parseThreadUsageReport(MIXED_REPORT);
    // 62 agent requests summing to the report's Opus row exactly
    const entries = Array.from({ length: 62 }, (_, i) =>
      i === 0
        ? usageEntry("claude-opus-5-5", {
            inputTokens: 148,
            outputTokens: 68_583,
            cacheCreationTokens: 587_401,
            cacheReadTokens: 12_635_752,
          })
        : usageEntry("claude-opus-5-5"),
    );

    const merged = mergeDayUsage(report, entries)!;
    expect(merged.aliases.get("claude-opus-5-5")).toBe("claude-opus-5-5");
    const byModel = Object.fromEntries(
      merged.breakdowns.map((b) => [b.modelName, b]),
    );
    expect(Object.keys(byModel).sort()).toEqual(["claude-opus-5-5", "gpt-5.6-terra"]);
    // Main-agent-only model: exactly the export
    expect(byModel["claude-opus-5-5"]).toMatchObject({
      inputTokens: 148,
      outputTokens: 68_583,
      cacheCreationTokens: 587_401,
      cacheReadTokens: 12_635_752,
    });
    // Subagent-only model: report totals, cache reads estimated
    const terra = byModel["gpt-5.6-terra"]!;
    expect(terra.outputTokens).toBe(2_791);
    expect(terra.inputTokens + terra.cacheReadTokens).toBe(481_661);
  });

  it("splits a shared model into exact agent and estimated subagent parts", () => {
    const report: AmpDayReport = {
      inputTokens: 1_000,
      cacheReadTokens: 900,
      outputTokens: 50,
      models: [{ name: "GPT-6.1 Sol", requests: 3, inputTokens: 1_000, outputTokens: 50 }],
      routing: [
        { modelId: "openai/gpt-6.1-sol", purpose: "Agent", requests: 2 },
        { modelId: "openai/gpt-6.1-sol", purpose: "Finder", requests: 1 },
      ],
    };
    const merged = mergeDayUsage(report, [
      usageEntry("gpt-6.1-sol", { inputTokens: 40, outputTokens: 20, cacheReadTokens: 360 }),
      usageEntry("gpt-6.1-sol", { outputTokens: 10 }),
    ])!;
    expect(merged.breakdowns).toEqual([
      {
        modelName: "gpt-6.1-sol",
        // 600 subagent input, of which 540 cache reads (900 - 360)
        inputTokens: 40 + 60,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 360 + 540,
        cost: 0,
      },
    ]);
  });

  it("returns null when the export cannot be matched to the report", () => {
    const report: AmpDayReport = {
      inputTokens: 100,
      cacheReadTokens: 0,
      outputTokens: 10,
      models: [{ name: "GPT-6.1 Sol", requests: 1, inputTokens: 100, outputTokens: 10 }],
      routing: [{ modelId: "openai/gpt-6.1-sol", purpose: "Agent", requests: 1 }],
    };
    // Neither the name nor the Agent request count (2 vs 1) matches
    expect(
      mergeDayUsage(report, [
        usageEntry("unknown-model", { inputTokens: 1 }),
        usageEntry("unknown-model", { inputTokens: 1 }),
      ]),
    ).toBeNull();
    // The export holds more than the report: inconsistent
    expect(
      mergeDayUsage(report, [usageEntry("gpt-6.1-sol", { inputTokens: 500 })]),
    ).toBeNull();
  });
});
