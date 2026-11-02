import { describe, expect, it } from "vitest";
import { usageFigures } from "@/components/usage-figures";

const usage = {
  totalCost: 100,
  totalTokens: 1_000_000,
  inputTokens: 100_000,
  outputTokens: 100_000,
  cacheCreationTokens: 100_000,
  cacheReadTokens: 700_000,
  cacheHitRate: 0.78,
  costPerMillionTokens: 100,
  requests: null,
  reasoningTokens: null,
  inputCost: 10,
  outputCost: 20,
  cacheCreationCost: 5,
  cacheReadCost: 5,
  cacheSavings: 30,
  speedPremium: 8,
  unpricedTokens: 0,
  splitCoverage: 0.4,
  unpricedShare: 0,
};
const note = (figures: ReturnType<typeof usageFigures>, label: string) =>
  figures.find((figure) => figure.label === label)?.note;

describe("usageFigures", () => {
  it("says how much of cost savings and premium cover", () => {
    const partial = usageFigures(usage);
    expect(note(partial, "Cache savings")).toBe(
      "Cache reads over uncached input; covers 40% of cost",
    );
    expect(note(partial, "Speed premium")).toBe(
      "Fast tiers over standard; covers 40% of cost",
    );
    expect(
      note(usageFigures({ ...usage, splitCoverage: 1 }), "Cache savings"),
    ).toBe("Cache reads over uncached input");
  });
});
