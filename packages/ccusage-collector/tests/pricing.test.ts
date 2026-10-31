import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPricing } from "../src/pricing/index";
import {
  estimateRequestCost,
  estimateTokenCost,
  isPricingTable,
  type PricingTable,
} from "../src/pricing/rates";
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

describe("request pricing", () => {
  const claude = {
    input: 2e-6,
    output: 10e-6,
    cacheCreation: 2.5e-6,
    cacheCreation1h: 4e-6,
    cacheRead: 0.2e-6,
    longContext: {
      threshold: 200_000,
      input: 4e-6,
      output: 15e-6,
      cacheCreation: 5e-6,
      cacheRead: 0.4e-6,
    },
    multipliers: { fast: 2, us: 1.1 },
  };
  const gpt = {
    input: 1e-6,
    output: 8e-6,
    cacheRead: 0.1e-6,
    priority: { input: 2e-6, output: 16e-6, cacheRead: 0.2e-6 },
    ultrafast: { input: 4e-6, output: 32e-6 },
    longContext: {
      threshold: 272_000,
      input: 2e-6,
      output: 12e-6,
      cacheRead: 0.2e-6,
      priority: { input: 4e-6, output: 24e-6, cacheRead: 0.4e-6 },
    },
  };
  const rated: PricingTable = { ...table, models: { claude, gpt } };
  const request = {
    inputTokens: 1_000,
    outputTokens: 100,
    cacheCreationTokens: 1_000,
    cacheReadTokens: 10_000,
  };
  const cost = (model: string, usage: Parameters<typeof estimateRequestCost>[2]) =>
    estimateRequestCost(rated, [model], usage)?.cost;

  it("prices one-hour cache writes at their own rate", () => {
    const base = 1_000 * 2e-6 + 100 * 10e-6 + 10_000 * 0.2e-6;
    expect(cost("claude", request)).toBeCloseTo(base + 1_000 * 2.5e-6, 12);
    expect(
      cost("claude", { ...request, cacheCreation1hTokens: 600 }),
    ).toBeCloseTo(base + 400 * 2.5e-6 + 600 * 4e-6, 12);
  });

  it("bills a whole request at long-context rates once its prompt passes the threshold", () => {
    const long = { ...request, cacheReadTokens: 198_001 };
    expect(cost("claude", long)).toBeCloseTo(
      1_000 * 4e-6 + 100 * 15e-6 + 1_000 * 5e-6 + 198_001 * 0.4e-6,
      12,
    );
    // One-hour writes keep their premium at the long-context tier
    expect(cost("claude", { ...long, cacheCreation1hTokens: 1_000 })).toBeCloseTo(
      1_000 * 4e-6 + 100 * 15e-6 + 1_000 * 8e-6 + 198_001 * 0.4e-6,
      12,
    );
    expect(cost("claude", { ...long, cacheReadTokens: 198_000 })).toBeCloseTo(
      1_000 * 2e-6 + 100 * 10e-6 + 1_000 * 2.5e-6 + 198_000 * 0.2e-6,
      12,
    );
  });

  it("applies fast mode, priority tiers and data residency", () => {
    const standard = cost("claude", request)!;
    expect(cost("claude", { ...request, speed: "fast" })).toBeCloseTo(
      standard * 2,
      12,
    );
    expect(
      cost("claude", { ...request, speed: "fast", inferenceGeo: "us" }),
    ).toBeCloseTo(standard * 2.2, 12);
    expect(cost("claude", { ...request, inferenceGeo: "global" })).toBeCloseTo(
      standard,
      12,
    );
    const codex = { ...request, cacheCreationTokens: 0 };
    expect(cost("gpt", { ...codex, speed: "fast" })).toBeCloseTo(
      1_000 * 2e-6 + 100 * 16e-6 + 10_000 * 0.2e-6,
      12,
    );
    // Missing tier cache rates fall back to the standard ones
    expect(cost("gpt", { ...codex, speed: "ultrafast" })).toBeCloseTo(
      1_000 * 4e-6 + 100 * 32e-6 + 10_000 * 0.1e-6,
      12,
    );
    // Past the threshold the tier has rates of its own
    const long = { ...codex, cacheReadTokens: 280_000 };
    expect(cost("gpt", { ...long, speed: "fast" })).toBeCloseTo(
      1_000 * 4e-6 + 100 * 24e-6 + 280_000 * 0.4e-6,
      12,
    );
    // ...and a tier without long-context rates bills the long-context ones
    expect(cost("gpt", { ...long, speed: "ultrafast" })).toBeCloseTo(
      1_000 * 2e-6 + 100 * 12e-6 + 280_000 * 0.2e-6,
      12,
    );
  });

  it("prices Claude context variants at the base model", () => {
    const variants = { ...table, models: { "claude-test-5": claude } };
    expect(
      estimateRequestCost(variants, ["claude-test-5[1m]"], request),
    ).toEqual({ model: "claude-test-5[1m]", cost: cost("claude", request) });
  });

  it("parses tiers, cache lifetimes and multipliers from LiteLLM", () => {
    const models = parseLiteLlmPricing({
      claude: {
        mode: "chat",
        input_cost_per_token: 2e-6,
        output_cost_per_token: 10e-6,
        cache_creation_input_token_cost: 2.5e-6,
        cache_creation_input_token_cost_above_1hr: 4e-6,
        cache_read_input_token_cost: 0.2e-6,
        input_cost_per_token_above_200k_tokens: 4e-6,
        output_cost_per_token_above_200k_tokens: 15e-6,
        cache_creation_input_token_cost_above_200k_tokens: 5e-6,
        cache_read_input_token_cost_above_200k_tokens: 0.4e-6,
        input_cost_per_token_above_200k_tokens_priority: 9,
        provider_specific_entry: { fast: 2, us: 1.1, note: "x" },
      },
      gpt: {
        mode: "chat",
        input_cost_per_token: 1e-6,
        output_cost_per_token: 8e-6,
        cache_read_input_token_cost: 0.1e-6,
        input_cost_per_token_priority: 2e-6,
        output_cost_per_token_priority: 16e-6,
        cache_read_input_token_cost_priority: 0.2e-6,
        input_cost_per_token_ultrafast: 4e-6,
        output_cost_per_token_ultrafast: 32e-6,
        input_cost_per_token_above_272k_tokens: 2e-6,
        output_cost_per_token_above_272k_tokens: 12e-6,
        cache_read_input_token_cost_above_272k_tokens: 0.2e-6,
        input_cost_per_token_above_272k_tokens_priority: 4e-6,
        output_cost_per_token_above_272k_tokens_priority: 24e-6,
        cache_read_input_token_cost_above_272k_tokens_priority: 0.4e-6,
      },
    });
    expect(models).toEqual({ claude, gpt });
    expect(isPricingTable({ ...table, models })).toBe(true);
    expect(
      isPricingTable({
        ...table,
        models: { m: { ...prices, longContext: { input: 1, output: 1 } } },
      }),
    ).toBe(false);
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
