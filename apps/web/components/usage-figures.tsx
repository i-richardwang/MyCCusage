"use client";

import {
  formatCount,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import type { UsageCounts, UsageRates } from "@/lib/usage-view";
import type { UsageMetrics } from "@/types/chart-types";

export interface Figure {
  label: string;
  value: string;
  // What the figure counts, where its label does not say
  note?: string;
}

// The figures of a selection, or of one model in it; rates without a base and
// counts no source reports are left out
export function usageFigures(
  usage: UsageMetrics & UsageRates & UsageCounts,
): Figure[] {
  const figures: (Figure | null)[] = [
    { label: "API cost", value: formatUsd(usage.totalCost) },
    { label: "Tokens", value: formatTokens(usage.totalTokens) },
    usage.costPerMillionTokens === null
      ? null
      : {
          label: "Per 1M tokens",
          value: formatUsd(usage.costPerMillionTokens),
        },
    usage.cacheHitRate === null
      ? null
      : {
          label: "Cache hit rate",
          value: formatPercent(usage.cacheHitRate),
          note: "Input read from cache",
        },
    { label: "Requests", value: formatCount(usage.requests) },
    usage.reasoningTokens === null
      ? null
      : {
          label: "Reasoning",
          value: formatTokens(usage.reasoningTokens),
          note: "Part of output, where reported",
        },
  ];
  return figures.filter((figure) => figure !== null);
}

export function UsageFigures({ figures }: { figures: Figure[] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(8rem,1fr))] gap-x-6 gap-y-4">
      {figures.map((figure) => (
        <div key={figure.label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">{figure.label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{figure.value}</dd>
          {figure.note && (
            <dd className="text-xs text-muted-foreground">{figure.note}</dd>
          )}
        </div>
      ))}
    </dl>
  );
}
