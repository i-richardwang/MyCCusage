import { describe, expect, it } from "vitest";
import {
  isValidThreadId,
  projectThreadExport,
  reportIsCurrent,
  threadActiveDays,
} from "../../src/amp/threads";
import {
  CALENDAR,
  DAY,
  DAY_KEY,
  NOON,
  at,
  cachedThread,
  exportJson,
} from "./fixtures";

describe("projectThreadExport", () => {
  it("keeps only assistant usage and message times, dropping content", () => {
    const raw = exportJson("T-abc", [
      {
        model: "claude-opus-5-5",
        timestamp: "2026-10-26T03:16:44.472Z",
        inputTokens: 10,
        outputTokens: 214,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 31875,
        totalInputTokens: 31890,
      },
    ]);
    const projected = projectThreadExport(raw, "T-abc");
    expect(projected.usage).toEqual([
      {
        timestamp: "2026-10-26T03:16:44.472Z",
        model: "claude-opus-5-5",
        inputTokens: 10,
        outputTokens: 214,
        cacheCreationTokens: 31875,
        cacheReadTokens: 5,
      },
    ]);
    expect(projected.activity).toEqual([NOON]);
    expect(JSON.stringify(projected)).not.toContain("large body");
  });

  it("rejects an export for a different thread", () => {
    expect(() => projectThreadExport(exportJson("T-other", []), "T-abc")).toThrow(
      "unexpected id",
    );
  });
});

describe("isValidThreadId", () => {
  it("only accepts T-<uuid> ids safe to use as file names", () => {
    expect(isValidThreadId("T-01a17635-a5a2-7751-980b-7b4a77a4299a")).toBe(true);
    expect(isValidThreadId("T-../../etc")).toBe(false);
    expect(isValidThreadId("abc")).toBe(false);
  });
});

describe("threadActiveDays", () => {
  it("covers message days and usage days", () => {
    const thread = projectThreadExport(
      exportJson("T-1", [
        { model: "m", timestamp: at("2026-10-22", 1) },
      ]),
      "T-1",
    );
    expect(threadActiveDays(thread, CALENDAR)).toEqual([DAY, "2026-10-22"]);
  });
});

describe("reportIsCurrent", () => {
  it("needs a report that is missing or older than the thread's update", () => {
    const thread = cachedThread({ id: "T-1" });
    expect(reportIsCurrent(thread, DAY, CALENDAR)).toBe(false);

    const earlier = at(DAY, 11);
    thread.reports[DAY_KEY] = { fetchedAt: earlier, report: null };
    expect(reportIsCurrent(thread, DAY, CALENDAR)).toBe(false);

    thread.reports[DAY_KEY] = { fetchedAt: NOON, report: null };
    expect(reportIsCurrent(thread, DAY, CALENDAR)).toBe(true);
  });

  it("treats a report fetched after the day ended as final", () => {
    const thread = cachedThread({
      id: "T-1",
      updated: at("2026-10-23"),
      reports: {
        [DAY_KEY]: { fetchedAt: at("2026-10-22", 2), report: null },
      },
    });
    expect(reportIsCurrent(thread, DAY, CALENDAR)).toBe(true);
  });
});
