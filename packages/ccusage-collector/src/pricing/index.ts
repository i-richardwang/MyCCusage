import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { isPricingTable, type PricingTable } from "./rates.js";
import { fetchLiteLlmPricing, parseLiteLlmPricing } from "./litellm.js";
import { snapshot } from "./snapshot.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface LoadPricingOptions {
  cacheFile?: string;
  now?: number;
  fetchPricing?: () => Promise<unknown>;
  warn?: (message: string) => void;
}

// Network and disk failures never prevent usage collection. The cache holds
// prices only; usage caches stay independent and can be repriced on each sync.
export async function loadPricing(
  options: LoadPricingOptions = {},
): Promise<PricingTable> {
  const cacheFile =
    options.cacheFile ?? join(homedir(), ".ccusage-collector", "pricing.json");
  const now = options.now ?? Date.now();
  const warn = options.warn ?? console.warn;
  let cached: PricingTable | undefined;
  try {
    const data: unknown = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (isPricingTable(data) && Date.parse(data.asOf) <= now) cached = data;
  } catch {
    // Missing or corrupt cache: refresh, with the bundled snapshot as fallback.
  }
  if (cached && now - Date.parse(cached.asOf) < CACHE_TTL_MS) return cached;

  let table: PricingTable;
  try {
    const models = parseLiteLlmPricing(
      await (options.fetchPricing ?? fetchLiteLlmPricing)(),
    );
    table = { asOf: new Date(now).toISOString(), models };
  } catch {
    // Prefer the newest available fallback, including a newer bundled snapshot.
    const fallback =
      cached && Date.parse(cached.asOf) > Date.parse(snapshot.asOf)
        ? cached
        : snapshot;
    warn(
      `Could not refresh LiteLLM pricing; using prices from ${fallback.asOf}.`,
    );
    return fallback;
  }

  const temporary = `${cacheFile}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(temporary, JSON.stringify(table), { mode: 0o600 });
    renameSync(temporary, cacheFile);
  } catch {
    warn(
      "Could not save LiteLLM pricing cache; using downloaded prices for this sync.",
    );
  } finally {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* Best-effort cleanup. */
    }
  }
  return table;
}
