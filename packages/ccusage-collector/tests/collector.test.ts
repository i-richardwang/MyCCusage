import { describe, expect, it } from "vitest";
import {
  extractJSON,
  getDailyRecordDate,
  mapCcusageRecord,
} from "../src/collector";

describe("extractJSON", () => {
  it("returns a clean JSON object untouched", () => {
    const json = '{"daily":[{"date":"2026-07-10"}]}';
    expect(extractJSON(json)).toBe(json);
  });

  it("strips interactive-shell noise before and after the JSON", () => {
    const stdout = 'Welcome to zsh!\n{"daily":[]}\nbye\n';
    expect(extractJSON(stdout)).toBe('{"daily":[]}');
  });

  it("handles nested braces", () => {
    const stdout = 'noise {"a":{"b":{"c":1}},"d":2} trailing';
    expect(extractJSON(stdout)).toBe('{"a":{"b":{"c":1}},"d":2}');
  });

  it("throws when no JSON object is present", () => {
    expect(() => extractJSON("command not found: ccusage")).toThrow(
      "No JSON object found",
    );
  });

  it("throws on unbalanced braces", () => {
    expect(() => extractJSON('{"daily":[')).toThrow("Malformed JSON");
  });
});

describe("getDailyRecordDate", () => {
  it("returns the date field when present", () => {
    expect(getDailyRecordDate({ date: "2026-07-10" })).toBe("2026-07-10");
  });

  it("rejects all-agent output (period/agent shaped records)", () => {
    expect(() => getDailyRecordDate({ period: "2026-07", agent: "claude" })).toThrow(
      "all-agent ccusage output",
    );
  });

  it("throws when the date is missing entirely", () => {
    expect(() => getDailyRecordDate({ inputTokens: 5 })).toThrow(
      "Missing daily record date",
    );
  });
});

describe("mapCcusageRecord", () => {
  it("maps a claude-style record (ccusage field names)", () => {
    const record = {
      date: "2026-07-10",
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 400,
      totalTokens: 1000,
      costUSD: 12.34,
      modelsUsed: ["claude-fable-5"],
      modelBreakdowns: [
        {
          modelName: "claude-fable-5",
          inputTokens: 100,
          outputTokens: 200,
          cacheCreationTokens: 300,
          cacheReadTokens: 400,
          cost: 12.34,
        },
      ],
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped).toMatchObject({
      date: "2026-07-10",
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationTokens: 300,
      cacheReadTokens: 400,
      totalTokens: 1000,
      totalCost: 12.34,
      credits: 0,
      modelsUsed: ["claude-fable-5"],
    });
    expect(mapped.rawData).toBe(record);
  });

  it("maps a codex-style record (models object, cachedInputTokens)", () => {
    const record = {
      date: "2026-07-10",
      inputTokens: 50,
      outputTokens: 60,
      cachedInputTokens: 70,
      totalTokens: 180,
      costUSD: 1.5,
      models: {
        "gpt-5.2": {
          inputTokens: 50,
          cachedInputTokens: 70,
          outputTokens: 60,
          reasoningOutputTokens: 10,
          totalTokens: 180,
          isFallback: false,
        },
      },
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped.cacheReadTokens).toBe(70);
    expect(mapped.modelsUsed).toEqual(["gpt-5.2"]);
    expect(mapped.modelBreakdowns).toEqual([
      {
        modelName: "gpt-5.2",
        inputTokens: 50,
        outputTokens: 60,
        cacheCreationTokens: 0,
        cacheReadTokens: 70,
        cost: 0,
      },
    ]);
  });

  it("keeps AMP credits and falls back to totalCost when costUSD is absent", () => {
    const record = {
      date: "2026-07-10",
      totalTokens: 10,
      totalCost: 2.5,
      credits: 42,
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped.totalCost).toBe(2.5);
    expect(mapped.credits).toBe(42);
  });

  it("defaults malformed numeric fields to 0 instead of propagating garbage", () => {
    const record = {
      date: "2026-07-10",
      inputTokens: "not-a-number",
      outputTokens: NaN,
      totalTokens: Infinity,
      costUSD: null,
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped.inputTokens).toBe(0);
    expect(mapped.outputTokens).toBe(0);
    expect(mapped.totalTokens).toBe(0);
    expect(mapped.totalCost).toBe(0);
    expect(mapped.modelsUsed).toEqual([]);
  });
});
