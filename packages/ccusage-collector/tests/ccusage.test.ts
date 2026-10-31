import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import {
  extractJSON,
  getDailyRecordDate,
  mapCcusageRecord,
  scopeCcusageCommand,
} from "../src/ccusage";

describe("scopeCcusageCommand", () => {
  it("passes the account time zone regardless of the shell's own zone", () => {
    const scoped = scopeCcusageCommand(
      "echo",
      "America/Argentina/Buenos_Aires",
    );
    const output = execFileSync(
      "/bin/sh",
      // Simulates an rc file setting the process time zone.
      ["-c", `export TZ=UTC; ${scoped.command}`],
      { env: scoped.env, encoding: "utf8" },
    );
    expect(output).toBe("--timezone America/Argentina/Buenos_Aires\n");
  });
});

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

  it("ignores braces and escaped quotes inside JSON strings", () => {
    const value = {
      daily: [{ date: "2026-07-10", model: 'model}\\"{variant' }],
    };
    const json = JSON.stringify(value);
    expect(extractJSON(`shell greeting\n${json}\nbye`)).toBe(json);
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
    expect(() =>
      getDailyRecordDate({ period: "2026-07", agent: "claude" }),
    ).toThrow("all-agent ccusage output");
  });

  it("throws when the date is missing entirely", () => {
    expect(() => getDailyRecordDate({ inputTokens: 5 })).toThrow(
      "Missing daily record date",
    );
  });
});

describe("mapCcusageRecord", () => {
  it("maps ccusage records with cache input fields", () => {
    const record = {
      date: "2026-07-10",
      inputTokens: 100,
      outputTokens: 200,
      cacheCreationInputTokens: 300,
      cacheReadInputTokens: 400,
      totalTokens: 1000,
      costUSD: 12.34,
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
      totalCost: 12.34,
      modelBreakdowns: record.modelBreakdowns,
    });
  });

  it("maps an antigravity-style record (flat new field names)", () => {
    const record = {
      date: "2026-05-05",
      inputTokens: 100,
      outputTokens: 30,
      cacheCreationTokens: 5,
      cacheReadTokens: 20,
      totalTokens: 165,
      totalCost: 0.000187,
      modelBreakdowns: [
        {
          modelName: "gemini-3-pro",
          inputTokens: 100,
          outputTokens: 30,
          cacheCreationTokens: 5,
          cacheReadTokens: 20,
          cost: 0.000187,
        },
      ],
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped.date).toBe("2026-05-05");
    expect(mapped.inputTokens).toBe(100);
    expect(mapped.cacheCreationTokens).toBe(5);
    expect(mapped.cacheReadTokens).toBe(20);
    expect(mapped.totalCost).toBe(0.000187);
  });

  it("falls back to totalCost when costUSD is absent", () => {
    const record = {
      date: "2026-07-10",
      totalTokens: 10,
      totalCost: 2.5,
    };

    const mapped = mapCcusageRecord(record);

    expect(mapped.totalCost).toBe(2.5);
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
    expect(mapped.totalCost).toBe(0);
    expect(mapped.modelBreakdowns).toEqual([]);
  });
});
