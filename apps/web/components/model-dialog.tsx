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
import { usePeriodLabels } from "@/hooks/use-period-labels";
import {
  formatAxisMetric,
  formatMetric,
  formatPercent,
  METRIC_NAMES,
  metricShare,
  metricValue,
} from "@/lib/format";
import {
  hoursNote,
  modelDaily,
  modelHourly,
  type ModelTotals,
  type UsageView,
} from "@/lib/usage-view";
import { AGENT_TYPE_LABELS } from "@/types/agent-types";
import type { Resolution, UsageMetric } from "@/types/chart-types";

interface ModelDialogProps {
  model: ModelTotals | null;
  view: UsageView;
  metric: UsageMetric;
  // Whether the model's trend is per day or per hour
  resolution: Resolution;
  timeZone: string;
  onClose: () => void;
}

// One model's usage in the period, opened from the breakdown
export function ModelDialog({
  model,
  onClose,
  ...details
}: ModelDialogProps) {
  return (
    <Dialog open={model !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        {model && <ModelDetails model={model} {...details} />}
      </DialogContent>
    </Dialog>
  );
}

function ModelDetails({
  model,
  view,
  metric,
  resolution,
  timeZone,
}: Omit<ModelDialogProps, "onClose"> & { model: ModelTotals }) {
  const agent = AGENT_CHART_CONFIG[model.agentType];
  const chartData = useMemo(
    () =>
      resolution === "hour"
        ? modelHourly(view, model).map((hour) => ({
            period: hour.hourStart,
            value: metricValue(metric, hour),
          }))
        : modelDaily(view, model).map((day) => ({
            period: day.date,
            value: metricValue(metric, day),
          })),
    [view, model, metric, resolution],
  );
  const labels = usePeriodLabels(resolution, timeZone);
  const note = hoursNote(view, resolution);

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
          {note && <span className="block">{note}</span>}
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
              dataKey="period"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={resolution === "hour" ? 48 : 32}
              tickFormatter={labels.tick}
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
                  labelFormatter={(_, payload) =>
                    labels.full(String(payload[0]?.payload?.period ?? ""))
                  }
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
