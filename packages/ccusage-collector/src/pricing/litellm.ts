import axios from "axios";
import {
  isTokenRate,
  type ContextRates,
  type ModelRates,
  type TokenRates,
} from "./rates.js";

const PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export async function fetchLiteLlmPricing(): Promise<unknown> {
  const response = await axios.get<unknown>(PRICING_URL, {
    timeout: 10_000,
    maxContentLength: 16 * 1024 * 1024,
    responseType: "json",
  });
  return response.data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// Rates of one variant, named by a field suffix ("" for the base rates)
function tokenRates(
  entry: Record<string, unknown>,
  suffix: string,
): TokenRates | undefined {
  const input = entry[`input_cost_per_token${suffix}`];
  const output = entry[`output_cost_per_token${suffix}`];
  if (!isTokenRate(input) || !isTokenRate(output)) return undefined;
  const cacheCreation = entry[`cache_creation_input_token_cost${suffix}`];
  const cacheRead = entry[`cache_read_input_token_cost${suffix}`];
  return {
    input,
    output,
    ...(isTokenRate(cacheCreation) ? { cacheCreation } : {}),
    ...(isTokenRate(cacheRead) ? { cacheRead } : {}),
  };
}

const LONG_CONTEXT_FIELD = /^input_cost_per_token_above_(\d+)k_tokens$/;

// Standard rates of a context size, with the service tiers priced at it
function contextRates(
  entry: Record<string, unknown>,
  suffix: string,
): ContextRates | undefined {
  const rates = tokenRates(entry, suffix);
  if (!rates) return undefined;
  const priority = tokenRates(entry, `${suffix}_priority`);
  const ultrafast = tokenRates(entry, `${suffix}_ultrafast`);
  return {
    ...rates,
    ...(priority ? { priority } : {}),
    ...(ultrafast ? { ultrafast } : {}),
  };
}

// The lowest prompt size above which the whole request costs more
function longContextRates(
  entry: Record<string, unknown>,
): ModelRates["longContext"] {
  const thresholds = Object.keys(entry)
    .map((field) => LONG_CONTEXT_FIELD.exec(field)?.[1])
    .filter((k): k is string => k !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of thresholds) {
    const rates = contextRates(entry, `_above_${k}k_tokens`);
    if (rates) return { ...rates, threshold: k * 1000 };
  }
  return undefined;
}

function priceMultipliers(
  entry: Record<string, unknown>,
): Record<string, number> | undefined {
  const specific = entry.provider_specific_entry;
  if (!isRecord(specific)) return undefined;
  const multipliers = Object.fromEntries(
    Object.entries(specific).filter(
      (pair): pair is [string, number] => isTokenRate(pair[1]) && pair[1] > 0,
    ),
  );
  return Object.keys(multipliers).length > 0 ? multipliers : undefined;
}

export function parseLiteLlmPricing(
  value: unknown,
): Record<string, ModelRates> {
  if (!isRecord(value)) throw new Error("Invalid LiteLLM pricing table");
  const models: Record<string, ModelRates> = Object.create(null);
  for (const [model, entry] of Object.entries(value)) {
    // Chat token rates do not cover image/audio billing dimensions.
    if (!isRecord(entry) || entry.mode !== "chat") continue;
    const base = contextRates(entry, "");
    if (!base) continue;
    const cacheCreation1h = entry.cache_creation_input_token_cost_above_1hr;
    const longContext = longContextRates(entry);
    const multipliers = priceMultipliers(entry);
    models[model] = {
      ...base,
      ...(isTokenRate(cacheCreation1h) ? { cacheCreation1h } : {}),
      ...(longContext ? { longContext } : {}),
      ...(multipliers ? { multipliers } : {}),
    };
  }
  if (Object.keys(models).length === 0)
    throw new Error("Empty LiteLLM pricing table");
  return models;
}
