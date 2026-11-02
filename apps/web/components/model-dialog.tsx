"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { TypeShares } from "@/components/type-shares";
import { UsageFigures, usageFigures } from "@/components/usage-figures";
import { AGENT_CHART_CONFIG } from "@/constants/chart-config";
import { formatChartDate } from "@/lib/date-utils";
import {
  formatAxisMetric,
  formatMetric,
  formatPercent,
  METRIC_NAMES,
  metricShare,
  metricValue,
} from "@/lib/format";
import { modelDaily, type ModelTotals, type UsageView } from "@/lib/usage-view";
import { AGENT_TYPE_LABELS } from "@/types/agent-types";
import type { UsageMetric } from "@/types/chart-types";

interface ModelDialogProps {
  model: ModelTotals | null;
  view: UsageView;
  metric: UsageMetric;
  onClose: () => void;
}

// One model's usage in the period, opened from the breakdown
export function ModelDialog({ model, view, metric, onClose }: ModelDialogProps) {
  return (
    <Dialog open={model !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {model && <ModelDetails model={model} view={view} metric={metric} />}
      </DialogContent>
    </Dialog>
  );
}

function ModelDetails({
  model,
  view,
  metric,
}: {
  model: ModelTotals;
  view: UsageView;
  metric: UsageMetric;
}) {
  const agent = AGENT_CHART_CONFIG[model.agentType];
  const chartData = useMemo(
    () =>
      modelDaily(view, model).map((day) => ({
        date: day.date,
        value: metricValue(metric, day),
      })),
    [view, model, metric],
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ backgroundColor: agent.color }}
          />
          {model.model || "Unattributed"}
        </DialogTitle>
        <DialogDescription>
          {AGENT_TYPE_LABELS[model.agentType]} ·{" "}
          {formatPercent(metricShare(metric, model))} of{" "}
          {METRIC_NAMES[metric].noun} in this period
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-8">
        <UsageFigures figures={usageFigures(model)} />

        <ChartContainer
          config={{
            value: { label: METRIC_NAMES[metric].title, color: agent.color },
          }}
          className="aspect-auto h-[200px] w-full"
        >
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatChartDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(value: number) => formatAxisMetric(metric, value)}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={(label) => formatChartDate(String(label))}
                  formatter={(value) => (
                    <span className="font-mono font-medium tabular-nums">
                      {formatMetric(metric, Number(value))}
                    </span>
                  )}
                />
              }
            />
            <Bar
              dataKey="value"
              fill="var(--color-value)"
              radius={2}
              maxBarSize={48}
            />
          </BarChart>
        </ChartContainer>

        <TypeShares usage={model} />
      </div>
    </>
  );
}
