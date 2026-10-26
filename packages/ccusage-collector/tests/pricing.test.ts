import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPricing } from "../src/pricing/index";
import { estimateTokenCost, type PricingTable } from "../src/pricing/rates";
import { parseLiteLlmPricing } from "../src/pricing/litellm";
import { snapshot } from "../src/pricing/snapshot";

const usage = {
  inputTokens: 100,
  outputTokens: 20,
  cacheCreationTokens: 10,
  cacheReadTokens: 200,
};
const prices = {
  input: 2e-6,
  output: 10e-6,
  cacheCreation: 2.5e-6,
  cacheRead: 0.2e-6,
};
const table: PricingTable = {
  asOf: "2027-01-01T00:00:00.000Z",
  models: { "test-model": prices },
};
const upstream = {
  "test-model": {
    mode: "chat",
    input_cost_per_token: 2e-6,
    output_cost_per_token: 10e-6,
    cache_creation_input_token_cost: 2.5e-6,
    cache_read_input_token_cost: 0.2e-6,
  },
};

describe("token pricing", () => {
  it("prices all four counters at base rates regardless of aggregate size", () => {
    expect(estimateTokenCost(table, ["test-model"], usage)!.cost).toBeCloseTo(
      0.000465,
    );
    expect(
      estimateTokenCost(table, ["test-model"], {
        ...usage,
        inputTokens: 1_000_000,
      })!.cost,
    ).toBeCloseTo(2.000265);
  });

  it("distinguishes missing cache rates from free cache usage", () => {
    const incomplete = { ...table, models: { m: { input: 1, output: 2 } } };
    expect(estimateTokenCost(incomplete, ["m"], usage)).toBeNull();
    expect(
      estimateTokenCost(incomplete, ["m"], {
        ...usage,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      }),
    ).toEqual({ model: "m", cost: 140 });
    const free = {
      ...table,
      models: {
        m: {
          input: 0,
          output: 0,
          cacheCreation: 0,
          cacheRead: 0,
        },
      },
    };
    expect(estimateTokenCost(free, ["m"], usage)).toEqual({
      model: "m",
      cost: 0,
    });
  });

  it("uses the first candidate with complete pricing and reports the chosen name", () => {
    const p = {
      ...table,
      models: {
        missingCache: { input: 1, output: 2 },
        paid: prices,
        free: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      },
    };
    expect(
      estimateTokenCost(p, ["unknown", "missingCache", "paid"], usage),
    ).toEqual({
      model: "paid",
      cost: expect.closeTo(0.000465),
    });
    expect(estimateTokenCost(p, ["free", "paid"], usage)).toEqual({
      model: "free",
      cost: 0,
    });
  });

  it("matches provider and separator variants without crossing model versions or vendors", () => {
    const p = {
      ...table,
      models: {
        "gpt-test": prices,
        "claude-test-1-2": prices,
        "meta/muse-test": prices,
        "vertex_ai/gemini-test": prices,
        "reseller/unknown": prices,
      },
    };
    for (const model of [
      "openai/gpt-test",
      "anthropic/claude-test-1.2",
      "muse-test",
      "vertexai/gemini-test",
    ]) {
      expect(estimateTokenCost(p, [model], usage)!.cost).toBeCloseTo(0.000465);
    }
    for (const model of [
      "gpt-test-pro",
      "claude-test-1-3",
      "unknown",
      "other/gpt-test",
      "toString",
    ]) {
      expect(estimateTokenCost(p, [model], usage)).toBeNull();
    }
  });

  it("rejects unusable prices and modalities while preserving explicit zero and absent cache rates", () => {
    const result = parseLiteLlmPricing({
      ...upstream,
      image: {
        mode: "image_generation",
        input_cost_per_token: 1,
        output_cost_per_token: 2,
      },
      bad: { mode: "chat", input_cost_per_token: -1, output_cost_per_token: 2 },
      missing: { mode: "chat", input_cost_per_token: 1 },
      free: { mode: "chat", input_cost_per_token: 0, output_cost_per_token: 0 },
    });
    expect(result["test-model"]).toEqual(prices);
    expect(result.free).toEqual({ input: 0, output: 0 });
    expect(Object.keys(result)).toHaveLength(2);
    expect(() => parseLiteLlmPricing({ error: "rate limited" })).toThrow();
    expect(() => parseLiteLlmPricing(null)).toThrow();
  });
});

describe("pricing cache", () => {
  const dirs: string[] = [];
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "myccusage-pricing-"));
    dirs.push(dir);
    return {
      cacheFile: join(dir, "pricing.json"),
      now: Date.parse(table.asOf),
      warn: vi.fn(),
    };
  }
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("downloads on first use and reuses a fresh cache without network access", async () => {
    const options = setup();
    const fetchPricing = vi.fn().mockResolvedValue(upstream);
    expect(await loadPricing({ ...options, fetchPricing })).toEqual(table);
    expect(JSON.parse(readFileSync(options.cacheFile, "utf8"))).toEqual(table);
    expect(
      await loadPricing({
        ...options,
        now: options.now + 3_600_000,
        fetchPricing,
      }),
    ).toEqual(table);
    expect(fetchPricing).toHaveBeenCalledTimes(1);
  });

  it("uses stale prices after a failed refresh and preserves the last valid cache", async () => {
    const options = setup();
    writeFileSync(options.cacheFile, JSON.stringify(table));
    const fetchPricing = vi
      .fn()
      .mockResolvedValue({ error: "invalid response" });
    expect(
      await loadPricing({
        ...options,
        now: options.now + 86_400_000,
        fetchPricing,
      }),
    ).toEqual(table);
    expect(fetchPricing).toHaveBeenCalledOnce();
    expect(options.warn).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(options.cacheFile, "utf8"))).toEqual(table);
  });

  it("refreshes an expired cache and replaces it only with valid prices", async () => {
    const options = setup();
    writeFileSync(options.cacheFile, JSON.stringify(table));
    const now = options.now + 86_400_000;
    const updated = await loadPricing({
      ...options,
      now,
      fetchPricing: async () => upstream,
    });
    expect(updated.asOf).toBe(new Date(now).toISOString());
    expect(JSON.parse(readFileSync(options.cacheFile, "utf8"))).toEqual(
      updated,
    );
  });

  it.each([
    "absent",
    "corrupt",
    "invalid rates",
    "future",
    "older than snapshot",
  ])(
    "uses the bundled snapshot offline when the cache is %s",
    async (state) => {
      const options = setup();
      if (state !== "absent")
        writeFileSync(
          options.cacheFile,
          state === "corrupt"
            ? "{"
            : JSON.stringify(
                state === "invalid rates"
                  ? { ...table, models: { m: { input: -1, output: 2 } } }
                  : {
                      ...table,
                      asOf: state === "future" ? "2099-01-01" : "2020-01-01",
                    },
              ),
        );
      const result = await loadPricing({
        ...options,
        fetchPricing: async () => {
          throw new Error("offline");
        },
      });
      expect(result).toBe(snapshot);
      expect(options.warn).toHaveBeenCalledOnce();
    },
  );

  it("uses downloaded prices even when the cache cannot be written", async () => {
    const options = setup();
    writeFileSync(options.cacheFile, "blocking parent path");
    const result = await loadPricing({
      ...options,
      cacheFile: join(options.cacheFile, "nested.json"),
      fetchPricing: async () => upstream,
    });
    expect(result).toEqual(table);
    expect(options.warn).toHaveBeenCalledOnce();
  });
});
