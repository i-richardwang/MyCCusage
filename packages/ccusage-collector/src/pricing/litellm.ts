import axios from "axios";
import { isTokenRate, type ModelRates } from "./rates.js";

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

export function parseLiteLlmPricing(
  value: unknown,
): Record<string, ModelRates> {
  if (!isRecord(value)) throw new Error("Invalid LiteLLM pricing table");
  const models: Record<string, ModelRates> = Object.create(null);
  for (const [model, entry] of Object.entries(value)) {
    // Chat token rates do not cover image/audio billing dimensions.
    if (!isRecord(entry) || entry.mode !== "chat") continue;
    const input = entry.input_cost_per_token;
    const output = entry.output_cost_per_token;
    if (!isTokenRate(input) || !isTokenRate(output)) continue;
    models[model] = {
      input,
      output,
      ...(isTokenRate(entry.cache_creation_input_token_cost)
        ? { cacheCreation: entry.cache_creation_input_token_cost }
        : {}),
      ...(isTokenRate(entry.cache_read_input_token_cost)
        ? { cacheRead: entry.cache_read_input_token_cost }
        : {}),
    };
  }
  if (Object.keys(models).length === 0)
    throw new Error("Empty LiteLLM pricing table");
  return models;
}
