"use client";

import { isPartial } from "@/constants/chart-config";
import {
  formatCost,
  formatCount,
  formatPercent,
  formatTokens,
  formatUsd,
} from "@/lib/format";
import type { CostDetails, ReportedCounts, UsageRates } from "@/lib/usage-view";
import type { UsageMetrics } from "@/types/chart-types";

export interface Figure {
  label: string;
  value: string;
  // What the figure counts, where its label does not say
  note?: string;
}

// The figures of a selection, or of one model in it; rates without a base,
// counts no selected record carries and amounts nothing recorded are left out
export function usageFigures(
  usage: UsageMetrics & UsageRates & ReportedCounts & CostDetails,
): Figure[] {
  // Savings and premium are known only where cost was split; say how much
  const withSplitCoverage = (note: string) =>
    isPartial(usage.splitCoverage)
      ? `${note}; covers ${formatPercent(usage.splitCoverage)} of cost`
      : note;
  const figures: (Figure | null)[] = [
    { label: "API cost", value: formatCost(usage) },
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
    usage.cacheSavings > 0
      ? {
          label: "Cache savings",
          value: formatUsd(usage.cacheSavings),
          note: withSplitCoverage("Cache reads over uncached input"),
        }
      : null,
    usage.speedPremium > 0
      ? {
          label: "Speed premium",
          value: formatUsd(usage.speedPremium),
          note: withSplitCoverage("Fast tiers over standard"),
        }
      : null,
    usage.unpricedShare
      ? {
          label: "Unpriced",
          value: formatTokens(usage.unpricedTokens),
          note: `${formatPercent(usage.unpricedShare)} of tokens, counted at $0`,
        }
      : null,
    usage.requests === null
      ? null
      : { label: "Requests", value: formatCount(usage.requests) },
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
