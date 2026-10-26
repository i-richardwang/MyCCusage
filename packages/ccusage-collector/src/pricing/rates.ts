import type { ModelBreakdown } from "../types.js";

export type TokenUsage = Pick<
  ModelBreakdown,
  "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens"
>;

// USD per token. Absent cache rates mean unknown, not free.
export interface ModelRates {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

export interface PricingTable {
  asOf: string;
  models: Record<string, ModelRates>;
}

export function isTokenRate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isPricingTable(value: unknown): value is PricingTable {
  if (
    !isRecord(value) ||
    typeof value.asOf !== "string" ||
    !Number.isFinite(Date.parse(value.asOf)) ||
    !isRecord(value.models)
  )
    return false;
  const models = Object.values(value.models);
  return (
    models.length > 0 &&
    models.every(
      (m) =>
        isRecord(m) &&
        isTokenRate(m.input) &&
        isTokenRate(m.output) &&
        (m.cacheCreation === undefined || isTokenRate(m.cacheCreation)) &&
        (m.cacheRead === undefined || isTokenRate(m.cacheRead)),
    )
  );
}

function findRates(
  models: PricingTable["models"],
  model: string,
): ModelRates | undefined {
  const candidates = [model];
  // Routing prefixes differ from LiteLLM's first-party keys. Only strip
  // known prefixes; never select a random reseller or a neighbouring SKU.
  const bare = model.replace(
    /^(?:openai|anthropic|deepseek|meta|vertexai|vertex_ai|gemini)\//,
    "",
  );
  candidates.push(bare);
  if (bare.startsWith("claude-")) candidates.push(bare.replaceAll(".", "-"));
  if (bare.startsWith("muse-")) candidates.push(`meta/${bare}`);
  if (bare.startsWith("gemini-"))
    candidates.push(`gemini/${bare}`, `vertex_ai/${bare}`);
  if (bare.startsWith("deepseek-")) candidates.push(`deepseek/${bare}`);
  if (bare.startsWith("gpt-")) candidates.push(`openai/${bare}`);
  for (const key of candidates) {
    if (Object.hasOwn(models, key)) return models[key];
  }
  return undefined;
}

export interface TokenCostEstimate {
  cost: number;
  model: string;
}

// Price candidates in order, using flat API-equivalent rates. Aggregates
// cannot establish a request's context tier, cache TTL or speed tier.
// null distinguishes missing pricing from an explicitly free model.
export function estimateTokenCost(
  table: PricingTable,
  models: readonly string[],
  usage: TokenUsage,
): TokenCostEstimate | null {
  for (const model of models) {
    const prices = findRates(table.models, model);
    if (
      !prices ||
      (usage.cacheCreationTokens > 0 && prices.cacheCreation === undefined) ||
      (usage.cacheReadTokens > 0 && prices.cacheRead === undefined)
    )
      continue;
    return {
      model,
      cost:
        usage.inputTokens * prices.input +
        usage.outputTokens * prices.output +
        usage.cacheCreationTokens * (prices.cacheCreation ?? 0) +
        usage.cacheReadTokens * (prices.cacheRead ?? 0),
    };
  }
  return null;
}
