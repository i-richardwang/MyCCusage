"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { ShareBar } from "@/components/share-bar";
import { UsageFigures, usageFigures } from "@/components/usage-figures";
import { tokenTypeSegments } from "@/hooks/use-chart-data";
import { formatTokens } from "@/lib/format";
import type { UsageSummary } from "@/lib/usage-view";

interface UsageTotalsProps {
  summary: UsageSummary;
}

export function UsageTotals({ summary }: UsageTotalsProps) {
  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Totals</CardTitle>
          <CardDescription>
            Input excludes cache reads and writes; output includes reasoning
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-8 px-4 pt-4 sm:px-6 sm:pt-6">
        <UsageFigures figures={usageFigures(summary)} />
        <ShareBar
          label="Tokens by type"
          segments={tokenTypeSegments(summary)}
          format={formatTokens}
        />
      </CardContent>
    </Card>
  );
}
