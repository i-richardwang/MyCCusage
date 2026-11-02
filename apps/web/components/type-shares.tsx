"use client";

import { ShareBar } from "@/components/share-bar";
import { isPartial } from "@/constants/chart-config";
import { costTypeSegments, tokenTypeSegments } from "@/hooks/use-chart-data";
import { formatPercent, formatTokens, formatUsd } from "@/lib/format";
import type { CostDetails } from "@/lib/usage-view";
import type { UsageMetrics } from "@/types/chart-types";

// How the tokens and the cost of a selection, or of one model in it, split by
// token type. The cost bar shows only the cost split by type and notes the
// rest.
export function TypeShares({ usage }: { usage: UsageMetrics & CostDetails }) {
  const coverage = usage.splitCoverage;
  return (
    <div className="flex flex-col gap-8">
      <ShareBar
        label="Tokens by type"
        segments={tokenTypeSegments(usage)}
        format={formatTokens}
      />
      <ShareBar
        label="Cost by type"
        segments={costTypeSegments(usage)}
        format={formatUsd}
        note={
          isPartial(coverage)
            ? `Covers ${formatPercent(coverage)} of cost; the rest was recorded without a split by type.`
            : undefined
        }
      />
    </div>
  );
}
