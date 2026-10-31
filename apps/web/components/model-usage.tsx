"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { AGENT_TYPE_LABELS } from "@/types/chart-types";
import type { ModelTotals } from "@/lib/usage-view";

interface ModelUsageProps {
  models: ModelTotals[];
}

const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`;
const formatTokens = (tokens: number) => `${(tokens / 1000000).toFixed(1)}M`;
// Counts the model's sources do not report
const formatKnown = (count: number | null, format: (n: number) => string) =>
  count === null ? "—" : format(count);

export function ModelUsage({ models }: ModelUsageProps) {
  if (models.length === 0) return null;

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Usage by Model</CardTitle>
          <CardDescription>
            Cost and tokens of each model in this period
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Model</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Agent</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Cost</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Tokens</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Reasoning</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Requests</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground w-1/4">Share of Cost</th>
              </tr>
            </thead>
            <tbody>
              {models.map((usage) => (
                <tr key={`${usage.agentType}:${usage.model}`} className="border-b">
                  <td className="py-3 px-2 text-sm font-medium">
                    {usage.model || (
                      <span className="text-muted-foreground">Unattributed</span>
                    )}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {AGENT_TYPE_LABELS[usage.agentType]}
                  </td>
                  <td className="py-3 px-2 text-sm font-bold">{formatCurrency(usage.totalCost)}</td>
                  <td className="py-3 px-2 text-sm">{formatTokens(usage.totalTokens)}</td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatKnown(usage.reasoningTokens, formatTokens)}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatKnown(usage.requests, (n) => n.toLocaleString("en-US"))}
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <Progress value={usage.costShare * 100} className="h-2" />
                      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                        {(usage.costShare * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
