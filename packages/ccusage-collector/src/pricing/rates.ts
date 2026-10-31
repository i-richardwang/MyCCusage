import type { ModelBreakdown } from "../types.js";

export type TokenUsage = Pick<
  ModelBreakdown,
  "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens"
>;

// USD per token. Absent cache rates mean unknown, not free.
export interface TokenRates {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

// Rates of one context size, with OpenAI's service tiers at that size
export interface ContextRates extends TokenRates {
  // Priority tier, which Codex fast mode uses
  priority?: TokenRates;
  ultrafast?: TokenRates;
}

export interface ModelRates extends ContextRates {
  // Cache writes kept for an hour instead of five minutes
  cacheCreation1h?: number;
  // Rates for a whole request whose prompt exceeds `threshold` tokens
  longContext?: ContextRates & { threshold: number };
  // Price multiples by request option, such as Claude fast mode ("fast") or
  // US-only inference ("us")
  multipliers?: Record<string, number>;
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

const isOptional = (value: unknown, check: (value: unknown) => boolean) =>
  value === undefined || check(value);

function isTokenRates(value: unknown): value is TokenRates {
  return (
    isRecord(value) &&
    isTokenRate(value.input) &&
    isTokenRate(value.output) &&
    isOptional(value.cacheCreation, isTokenRate) &&
    isOptional(value.cacheRead, isTokenRate)
  );
}

function isContextRates(value: unknown): value is ContextRates {
  return (
    isRecord(value) &&
    isTokenRates(value) &&
    isOptional(value.priority, isTokenRates) &&
    isOptional(value.ultrafast, isTokenRates)
  );
}

function isModelRates(value: unknown): value is ModelRates {
  return (
    isRecord(value) &&
    isContextRates(value) &&
    isOptional(value.cacheCreation1h, isTokenRate) &&
    isOptional(
      value.longContext,
      (rates) =>
        isRecord(rates) &&
        isContextRates(rates) &&
        isTokenRate(rates.threshold),
    ) &&
    isOptional(
      value.multipliers,
      (multipliers) =>
        isRecord(multipliers) &&
        Object.values(multipliers).every(isTokenRate),
    )
  );
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
  return models.length > 0 && models.every(isModelRates);
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
  if (bare.startsWith("claude-")) {
    // Context variants such as "[1m]" share the base model's rates
    const base = bare.replace(/\[[^\]]*\]$/, "");
    candidates.push(base, base.replaceAll(".", "-"));
  }
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

// Cost of the usage at one set of rates; null when a counter the usage
// needs has no rate
function costAt(rates: TokenRates, usage: TokenUsage): number | null {
  if (
    (usage.cacheCreationTokens > 0 && rates.cacheCreation === undefined) ||
    (usage.cacheReadTokens > 0 && rates.cacheRead === undefined)
  )
    return null;
  return (
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    usage.cacheCreationTokens * (rates.cacheCreation ?? 0) +
    usage.cacheReadTokens * (rates.cacheRead ?? 0)
  );
}

// The first candidate model whose rates price the usage. null distinguishes
// missing pricing from an explicitly free model.
function firstPriced(
  table: PricingTable,
  models: readonly string[],
  price: (rates: ModelRates) => number | null,
): TokenCostEstimate | null {
  for (const model of models) {
    const rates = findRates(table.models, model);
    const cost = rates ? price(rates) : null;
    if (cost !== null) return { model, cost };
  }
  return null;
}

// Price aggregated usage at flat API-equivalent rates. Aggregates cannot
// establish a request's context tier, cache TTL or speed tier.
export function estimateTokenCost(
  table: PricingTable,
  models: readonly string[],
  usage: TokenUsage,
): TokenCostEstimate | null {
  return firstPriced(table, models, (rates) => costAt(rates, usage));
}

// One API request, the unit providers bill. Input excludes cache reads and
// writes; reasoning is part of output and never priced separately.
export interface RequestUsage extends TokenUsage {
  // Part of cacheCreationTokens written with a one-hour lifetime
  cacheCreation1hTokens?: number;
  // "fast" is Claude fast mode or OpenAI's priority tier
  speed?: "standard" | "fast" | "ultrafast";
  // Data residency of the request, priced by a multiplier such as "us"
  inferenceGeo?: string;
}

// Price one request. A request whose prompt passes the long-context threshold
// is billed entirely at long-context rates, as Anthropic and OpenAI do.
export function estimateRequestCost(
  table: PricingTable,
  models: readonly string[],
  usage: RequestUsage,
): TokenCostEstimate | null {
  const prompt =
    usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const cacheCreation1h = Math.min(
    usage.cacheCreation1hTokens ?? 0,
    usage.cacheCreationTokens,
  );
  return firstPriced(table, models, (prices) => {
    const context: ContextRates =
      prices.longContext && prompt > prices.longContext.threshold
        ? prices.longContext
        : prices;
    const tier =
      usage.speed === "fast"
        ? context.priority
        : usage.speed === "ultrafast"
          ? context.ultrafast
          : undefined;
    const variant = tier ?? context;
    // A variant without cache rates of its own uses its context's, then the
    // model's
    const rates: TokenRates = {
      ...variant,
      cacheCreation:
        variant.cacheCreation ?? context.cacheCreation ?? prices.cacheCreation,
      cacheRead: variant.cacheRead ?? context.cacheRead ?? prices.cacheRead,
    };
    const cost = costAt(rates, usage);
    if (cost === null) return null;
    // One-hour writes keep their premium over five-minute writes in every tier
    const premium =
      prices.cacheCreation1h !== undefined && prices.cacheCreation
        ? prices.cacheCreation1h / prices.cacheCreation
        : 1;
    const oneHourWrites =
      cacheCreation1h * (rates.cacheCreation ?? 0) * (premium - 1);
    // Claude fast mode is a multiple of the rates instead of a tier
    const speedMultiple =
      usage.speed === "fast" && !tier ? (prices.multipliers?.fast ?? 1) : 1;
    const geoMultiple = usage.inferenceGeo
      ? (prices.multipliers?.[usage.inferenceGeo] ?? 1)
      : 1;
    return (cost + oneHourWrites) * speedMultiple * geoMultiple;
  });
}
