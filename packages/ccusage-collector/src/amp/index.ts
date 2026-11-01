import type { Calendar } from "../calendar.js";
import type { UsageBucket } from "../types.js";
import type { PricingTable } from "../pricing/rates.js";
import {
  createAmpRunner,
  findAmpBinary,
  readAmpInstallationId,
} from "./cli.js";
import { aggregateAmpUsage } from "./usage.js";
import { loadCachedThreads, REPORTS_PER_HOUR, syncAmpCache } from "./sync.js";

// Amp keeps threads server-side, so there is nothing local to read. Usage is
// collected through the user's authenticated `amp` CLI instead: thread
// exports give the main agent's usage per message, and per-day usage reports
// add subagents (see report.ts). Both are cached locally (sync.ts) and
// rebuilt into hour buckets on every run, because each upload replaces whole
// days.
export async function collectAmpUsage(
  calendar: Calendar,
  loadPricing: () => Promise<PricingTable>,
): Promise<UsageBucket[]> {
  const binary = findAmpBinary();
  if (!binary) {
    throw new Error(
      "Amp CLI not found. Install it from https://ampcode.com and run `amp login`.",
    );
  }
  const installationId = readAmpInstallationId();
  if (!installationId) {
    throw new Error(
      "Amp installation id not found (~/.local/share/amp/device-id.json). Run `amp` once to initialize it.",
    );
  }

  console.log(`Collecting amp usage data via: ${binary} threads export/usage`);
  const result = await syncAmpCache(
    createAmpRunner(binary),
    installationId,
    calendar,
  );
  console.log(
    `Amp threads: ${result.listed} listed, ${result.exported} exported, ${result.unchanged} unchanged` +
      (result.failed ? `, ${result.failed} failed` : "") +
      (result.deferred ? `, ${result.deferred} deferred to the next run` : ""),
  );
  console.log(
    `Amp usage reports: ${result.reportsFetched} fetched` +
      (result.reportsPending
        ? `, ${result.reportsPending} pending (up to ${REPORTS_PER_HOUR}/hour; those days count the main agent only until fetched)`
        : ""),
  );

  const unreconciled: string[] = [];
  const threads = loadCachedThreads();
  if (threads.length === 0) return [];
  const pricing = await loadPricing();
  const { buckets, unpricedModels } = aggregateAmpUsage(threads, {
    calendar,
    onUnreconciled: (threadId, date) =>
      unreconciled.push(`${threadId} ${date}`),
    pricing,
  });
  if (unpricedModels.length > 0) {
    console.warn(
      `Amp API-equivalent cost is incomplete: no usable token pricing for ${unpricedModels.join(", ")}. Their tokens are included, with cost 0.`,
    );
  }
  if (unreconciled.length > 0) {
    console.warn(
      `${unreconciled.length} Amp thread-day(s) could not be reconciled with their usage report and count the main agent only (first: ${unreconciled[0]})`,
    );
  }
  return buckets;
}
