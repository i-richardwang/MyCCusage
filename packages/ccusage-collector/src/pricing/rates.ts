// Token counters a cost is estimated from. Input excludes cache reads and
// writes.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

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

// What usage cost, split the way providers bill it
export interface PricedUsage {
  cost: number;
  // Parts of cost by token type. They add up to cost wherever rates priced
  // the usage; a cost the agent recorded without rates to split it by stays
  // unsplit, its parts zero.
  inputCost: number;
  outputCost: number;
  cacheCreationCost: number;
  cacheReadCost: number;
  // What cache reads saved over paying for them as uncached input
  cacheSavings: number;
  // Part of cost paid for a fast or ultrafast tier over standard
  speedPremium: number;
  // Tokens neither rates nor the agent priced; they count at zero cost
  unpricedTokens: number;
}

export const NO_COST: PricedUsage = {
  cost: 0,
  inputCost: 0,
  outputCost: 0,
  cacheCreationCost: 0,
  cacheReadCost: 0,
  cacheSavings: 0,
  speedPremium: 0,
  unpricedTokens: 0,
};

type CostParts = Pick<
  PricedUsage,
  "inputCost" | "outputCost" | "cacheCreationCost" | "cacheReadCost"
>;

// Usage priced at list rates, before an agent's own cost replaces them
interface ListPrice {
  parts: CostParts;
  cacheSavings: number;
}

const partsTotal = (parts: CostParts) =>
  parts.inputCost +
  parts.outputCost +
  parts.cacheCreationCost +
  parts.cacheReadCost;

// The usage at one set of rates; null when a counter the usage needs has no
// rate
function listPrice(rates: TokenRates, usage: TokenUsage): ListPrice | null {
  if (
    (usage.cacheCreationTokens > 0 && rates.cacheCreation === undefined) ||
    (usage.cacheReadTokens > 0 && rates.cacheRead === undefined)
  )
    return null;
  const cacheRead = rates.cacheRead ?? 0;
  return {
    parts: {
      inputCost: usage.inputTokens * rates.input,
      outputCost: usage.outputTokens * rates.output,
      cacheCreationCost: usage.cacheCreationTokens * (rates.cacheCreation ?? 0),
      cacheReadCost: usage.cacheReadTokens * cacheRead,
    },
    cacheSavings: usage.cacheReadTokens * Math.max(rates.input - cacheRead, 0),
  };
}

const tokenTotal = (usage: TokenUsage) =>
  usage.inputTokens +
  usage.outputTokens +
  usage.cacheCreationTokens +
  usage.cacheReadTokens;

const scaled = (parts: CostParts, scale: number): CostParts => ({
  inputCost: parts.inputCost * scale,
  outputCost: parts.outputCost * scale,
  cacheCreationCost: parts.cacheCreationCost * scale,
  cacheReadCost: parts.cacheReadCost * scale,
});

// Usage priced at list rates, standard costing what the same usage costs
// without a speed tier. An agent's own cost is kept, split in the
// proportions of the list price.
function fromListPrice(
  list: ListPrice,
  standard: number,
  reportedCost: number | null,
): PricedUsage {
  const listCost = partsTotal(list.parts);
  if (reportedCost !== null && listCost <= 0)
    return { ...NO_COST, cost: reportedCost };
  const scale = reportedCost === null ? 1 : reportedCost / listCost;
  return {
    cost: reportedCost ?? listCost,
    ...scaled(list.parts, scale),
    cacheSavings: list.cacheSavings * scale,
    speedPremium: Math.max(listCost - standard, 0) * scale,
    unpricedTokens: 0,
  };
}

// Usage no rates price: the agent's own cost, unsplit, or nothing
function withoutListPrice(
  usage: TokenUsage,
  reportedCost: number | null,
): PricedUsage {
  return reportedCost === null
    ? { ...NO_COST, unpricedTokens: tokenTotal(usage) }
    : { ...NO_COST, cost: reportedCost };
}

// Price aggregated usage at flat API-equivalent rates of the first candidate
// model that prices it. Aggregates cannot establish a request's context tier,
// cache TTL or speed tier.
export function priceTotals(
  table: PricingTable,
  models: readonly string[],
  usage: TokenUsage,
): PricedUsage {
  for (const model of models) {
    const rates = findRates(table.models, model);
    const list = rates && listPrice(rates, usage);
    if (list) return fromListPrice(list, partsTotal(list.parts), null);
  }
  return withoutListPrice(usage, null);
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

// One request at a model's list rates and a speed. A request whose prompt
// passes the long-context threshold is billed entirely at long-context rates,
// as Anthropic and OpenAI do.
function requestListPrice(
  prices: ModelRates,
  usage: RequestUsage,
  speed: RequestUsage["speed"],
): ListPrice | null {
  const prompt =
    usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;
  const context: ContextRates =
    prices.longContext && prompt > prices.longContext.threshold
      ? prices.longContext
      : prices;
  const tier =
    speed === "fast"
      ? context.priority
      : speed === "ultrafast"
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
  const list = listPrice(rates, usage);
  if (!list) return null;
  // One-hour writes keep their premium over five-minute writes in every tier
  const premium =
    prices.cacheCreation1h !== undefined && prices.cacheCreation
      ? prices.cacheCreation1h / prices.cacheCreation
      : 1;
  const cacheCreation1h = Math.min(
    usage.cacheCreation1hTokens ?? 0,
    usage.cacheCreationTokens,
  );
  const parts = {
    ...list.parts,
    cacheCreationCost:
      list.parts.cacheCreationCost +
      cacheCreation1h * (rates.cacheCreation ?? 0) * (premium - 1),
  };
  // Claude fast mode is a multiple of the rates instead of a tier
  const speedMultiple =
    speed === "fast" && !tier ? (prices.multipliers?.fast ?? 1) : 1;
  const geoMultiple = usage.inferenceGeo
    ? (prices.multipliers?.[usage.inferenceGeo] ?? 1)
    : 1;
  const multiple = speedMultiple * geoMultiple;
  return {
    parts: scaled(parts, multiple),
    cacheSavings: list.cacheSavings * multiple,
  };
}

// Price one request at the rates of the first candidate model that prices
// it. A cost the agent recorded itself is preferred over list prices.
export function priceRequest(
  table: PricingTable,
  models: readonly string[],
  usage: RequestUsage,
  reportedCost: number | null,
): PricedUsage {
  const speed = usage.speed ?? "standard";
  for (const model of models) {
    const prices = findRates(table.models, model);
    const list = prices && requestListPrice(prices, usage, speed);
    if (!list) continue;
    const standard =
      speed === "standard"
        ? list
        : (requestListPrice(prices, usage, "standard") ?? list);
    return fromListPrice(list, partsTotal(standard.parts), reportedCost);
  }
  return withoutListPrice(usage, reportedCost);
}
