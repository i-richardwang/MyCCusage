"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { AGENT_CHART_CONFIG } from "@/constants/chart-config";
import {
  formatCount,
  formatMetric,
  formatPercent,
  METRIC_NAMES,
  metricShare,
  metricValue,
  otherMetric,
} from "@/lib/format";
import { byMetric, type UsageShares, type UsageView } from "@/lib/usage-view";
import type {
  ChartConfig,
  UsageMetric,
  UsageMetrics,
} from "@/types/chart-types";

interface UsageOverviewProps {
  view: UsageView;
  metric: UsageMetric;
  // Label and color of each device with usage
  deviceSeries: ChartConfig;
}

interface ShareRow extends UsageMetrics, UsageShares {
  key: string;
  label: string;
  color: string;
}

// The period's total, and the share of it each agent and device has
export function UsageOverview({
  view,
  metric,
  deviceSeries,
}: UsageOverviewProps) {
  const { summary } = view;
  const other = otherMetric(metric);
  const facts = [
    `${formatMetric(other, metricValue(other, summary))} ${METRIC_NAMES[other].noun}`,
    `${formatCount(summary.requests)} requests`,
  ];

  const agentRows: ShareRow[] = view.agents.map((agent) => ({
    ...agent,
    key: agent.agentType,
    ...AGENT_CHART_CONFIG[agent.agentType],
  }));
  const deviceRows: ShareRow[] = view.devices.map((device) => ({
    ...device,
    key: device.deviceId,
    label: deviceSeries[device.deviceId]?.label ?? device.deviceId,
    color: deviceSeries[device.deviceId]?.color ?? "var(--muted-foreground)",
  }));

  return (
    <Card className="h-full pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Overview</CardTitle>
          <CardDescription>
            {metric === "cost"
              ? "API-equivalent cost of the period"
              : "Tokens processed in the period"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-1">
          <span className="text-4xl font-semibold tabular-nums">
            {formatMetric(metric, metricValue(metric, summary))}
          </span>
          <span className="text-xs text-muted-foreground">
            {facts.join(" · ")}
          </span>
        </div>

        <ShareRows title="Agents" rows={agentRows} metric={metric} />
        {deviceRows.length > 1 && (
          <ShareRows title="Devices" rows={deviceRows} metric={metric} />
        )}
      </CardContent>
    </Card>
  );
}

function ShareRows({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: ShareRow[];
  metric: UsageMetric;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No usage in this period.</p>
    );
  }
  const other = otherMetric(metric);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {[...rows].sort(byMetric(metric)).map((row) => (
        <div key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-4">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">{row.label}</span>
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">
              {formatMetric(metric, metricValue(metric, row))}
            </span>
          </div>
          <span className="pl-4 text-xs text-muted-foreground">
            {formatPercent(metricShare(metric, row))} of{" "}
            {METRIC_NAMES[metric].noun} ·{" "}
            {formatMetric(other, metricValue(other, row))}{" "}
            {METRIC_NAMES[other].noun}
          </span>
        </div>
      ))}
    </section>
  );
}
