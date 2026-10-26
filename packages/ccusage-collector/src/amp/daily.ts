import type { DailyUsageRecord, ModelBreakdown } from "../types.js";
import { mergeDayUsage, stripProvider } from "./report.js";
import { usageDate, type AmpCachedThread, type AmpUsageEntry } from "./threads.js";

// Name models without their provider prefix ("meta/muse-spark" ->
// "muse-spark"), as report-based days do. Only Anthropic models have real
// cache writes; for the rest Amp reports inputTokens as 0 and puts uncached
// input under cacheCreationInputTokens (its own `amp usage` report shows it as
// uncached input), so move it back.
function normalizeEntry(entry: AmpUsageEntry): AmpUsageEntry {
  const model = stripProvider(entry.model);
  if (model.includes("claude")) return { ...entry, model };
  return {
    ...entry,
    model,
    inputTokens: entry.inputTokens + entry.cacheCreationTokens,
    cacheCreationTokens: 0,
  };
}

function addBreakdown(
  models: Map<string, ModelBreakdown>,
  breakdown: ModelBreakdown,
): void {
  const total = models.get(breakdown.modelName);
  if (!total) {
    models.set(breakdown.modelName, { ...breakdown });
    return;
  }
  total.inputTokens += breakdown.inputTokens;
  total.outputTokens += breakdown.outputTokens;
  total.cacheCreationTokens += breakdown.cacheCreationTokens;
  total.cacheReadTokens += breakdown.cacheReadTokens;
}

function exportBreakdowns(
  entries: AmpUsageEntry[],
  aliases: Map<string, string>,
): ModelBreakdown[] {
  const models = new Map<string, ModelBreakdown>();
  for (const entry of entries) {
    addBreakdown(models, {
      modelName: aliases.get(entry.model) ?? entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheCreationTokens: entry.cacheCreationTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cost: 0,
    });
  }
  return [...models.values()];
}

function tokenTotal(usage: Omit<ModelBreakdown, "modelName" | "cost">): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationTokens +
    usage.cacheReadTokens
  );
}

interface ThreadDay {
  date: string;
  // Main agent + subagents, when the day's report reconciled
  merged: ModelBreakdown[] | null;
  // Main agent only, from the export
  entries: AmpUsageEntry[];
}

// Daily per-model usage across threads. Days with a reconciled usage report
// include subagents; days without one (not fetched yet, or not reconcilable)
// count the main agent only. Amp exports carry no cost, so cost stays 0.
export function aggregateAmpDaily(
  threads: AmpCachedThread[],
  onUnreconciled: (threadId: string, date: string) => void = () => {},
): DailyUsageRecord[] {
  // Export and report name some models differently; learn the mapping from
  // reconciled days so the other days use the report names too.
  const aliases = new Map<string, string>();
  const threadDays: ThreadDay[] = [];

  for (const thread of threads) {
    const entriesByDay = new Map<string, AmpUsageEntry[]>();
    for (const entry of thread.usage) {
      const date = usageDate(entry, thread.created);
      if (!date) continue;
      const entries = entriesByDay.get(date) ?? [];
      entries.push(normalizeEntry(entry));
      entriesByDay.set(date, entries);
    }

    const dates = new Set([...entriesByDay.keys(), ...Object.keys(thread.reports)]);
    for (const date of dates) {
      const entries = entriesByDay.get(date) ?? [];
      const reportEntry = thread.reports[date];
      const merged = reportEntry?.report
        ? mergeDayUsage(reportEntry.report, entries)
        : null;
      if (merged) {
        for (const [from, to] of merged.aliases) aliases.set(from, to);
      } else if (reportEntry) {
        onUnreconciled(thread.id, date);
      }
      threadDays.push({ date, merged: merged?.breakdowns ?? null, entries });
    }
  }

  const days = new Map<string, Map<string, ModelBreakdown>>();
  for (const { date, merged, entries } of threadDays) {
    const models = days.get(date) ?? new Map<string, ModelBreakdown>();
    days.set(date, models);
    for (const breakdown of merged ?? exportBreakdowns(entries, aliases)) {
      addBreakdown(models, breakdown);
    }
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => {
      const modelBreakdowns = [...models.values()].filter((m) => tokenTotal(m) > 0);
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
      for (const m of modelBreakdowns) {
        totals.inputTokens += m.inputTokens;
        totals.outputTokens += m.outputTokens;
        totals.cacheCreationTokens += m.cacheCreationTokens;
        totals.cacheReadTokens += m.cacheReadTokens;
      }
      return {
        date,
        ...totals,
        totalTokens: tokenTotal(totals),
        totalCost: 0,
        modelsUsed: modelBreakdowns.map((m) => m.modelName),
        modelBreakdowns,
      };
    })
    .filter((record) => record.totalTokens > 0);
}
