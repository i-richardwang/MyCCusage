import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AmpRunner } from "../../src/amp/cli";
import { aggregateAmpDaily } from "../../src/amp/daily";
import { loadCachedThreads, syncAmpCache } from "../../src/amp/sync";
import { SINGLE_MODEL_REPORT, UNPRICED, exportJson } from "./fixtures";

const RATE_LIMITED =
  "Usage information is limited to 60 requests per hour. Wait an hour before trying again.";

describe("syncAmpCache", () => {
  // Today's activity, so day reports are not final yet and follow updates
  const now = new Date().toISOString();
  const afterNow = new Date(Date.now() + 60_000).toISOString();
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), "amp-cache-test-"));
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  function fakeAmp(
    threads: Array<{ id: string; updated: string }>,
    usage: () => string = () => SINGLE_MODEL_REPORT,
  ) {
    const calls: string[][] = [];
    const run: AmpRunner = async (args) => {
      calls.push(args);
      if (args[1] === "list") {
        expect(args).toContain("--installation-id");
        return JSON.stringify(threads);
      }
      if (args[1] === "usage") return usage();
      return exportJson(
        args[2]!,
        [{ model: "gpt-6.1-sol", timestamp: now, outputTokens: 1 }],
        now,
      );
    };
    const of = (command: string) =>
      calls.filter((c) => c[1] === command).map((c) => c[2]);
    return { run, exports: () => of("export"), reports: () => of("usage") };
  }

  it("refreshes only threads whose updated time changed", async () => {
    const first = fakeAmp([
      { id: "T-1", updated: now },
      { id: "T-2", updated: now },
    ]);
    const r1 = await syncAmpCache(first.run, "inst", cacheDir);
    expect(r1).toMatchObject({
      listed: 2,
      exported: 2,
      unchanged: 0,
      reportsFetched: 2,
    });

    const second = fakeAmp([
      { id: "T-1", updated: now },
      { id: "T-2", updated: afterNow },
      { id: "T-3", updated: now },
    ]);
    const r2 = await syncAmpCache(second.run, "inst", cacheDir);
    expect(r2).toMatchObject({ listed: 3, exported: 2, unchanged: 1 });
    expect(second.exports().sort()).toEqual(["T-2", "T-3"]);
    // T-1's report was fetched after its last update, so it is kept
    expect(second.reports().sort()).toEqual(["T-2", "T-3"]);

    const daily = aggregateAmpDaily(loadCachedThreads(cacheDir), {
      pricing: UNPRICED,
    });
    expect(daily[0]!.totalTokens).toBe(3 * 165);
  });

  it("keeps exports when usage reports hit Amp's hourly limit", async () => {
    const threads = [
      { id: "T-1", updated: now },
      { id: "T-2", updated: now },
    ];
    const limited = fakeAmp(threads, () => {
      throw new Error(RATE_LIMITED);
    });
    const r1 = await syncAmpCache(limited.run, "inst", cacheDir);
    expect(r1).toMatchObject({
      exported: 2,
      failed: 0,
      reportsFetched: 0,
      reportsPending: 2,
    });
    // Requests already in flight finish; nothing new starts after the limit
    expect(limited.reports().length).toBeLessThanOrEqual(2);

    // Still blocked on the next run: no report requests at all
    const again = fakeAmp(threads);
    const r2 = await syncAmpCache(again.run, "inst", cacheDir);
    expect(r2).toMatchObject({ exported: 0, reportsPending: 2 });
    expect(again.reports()).toEqual([]);

    // Main-agent usage is still collected
    const daily = aggregateAmpDaily(loadCachedThreads(cacheDir), {
      pricing: UNPRICED,
    });
    expect(daily[0]!.outputTokens).toBe(2);
  });

  it("rebuilds the cache for another installation but keeps the rate limit", async () => {
    const threads = [{ id: "T-1", updated: now }];
    await syncAmpCache(
      fakeAmp(threads, () => {
        throw new Error(RATE_LIMITED);
      }).run,
      "inst-a",
      cacheDir,
    );

    const other = fakeAmp(threads);
    const result = await syncAmpCache(other.run, "inst-b", cacheDir);
    expect(other.exports()).toEqual(["T-1"]);
    expect(other.reports()).toEqual([]);
    expect(result.reportsPending).toBe(1);

    const index = JSON.parse(
      readFileSync(join(cacheDir, "index.json"), "utf8"),
    );
    expect(index.installationId).toBe("inst-b");
    expect(index.reportsBlockedUntil).toBeDefined();
  });

  it("counts failed exports and retries them next run", async () => {
    const threads = [{ id: "T-1", updated: now }];
    const failing: AmpRunner = async (args) => {
      if (args[1] === "list") return JSON.stringify(threads);
      throw new Error("boom");
    };
    const r1 = await syncAmpCache(failing, "inst", cacheDir);
    expect(r1).toMatchObject({ exported: 0, failed: 1 });

    const r2 = await syncAmpCache(fakeAmp(threads).run, "inst", cacheDir);
    expect(r2).toMatchObject({ exported: 1, failed: 0 });
  });
});
