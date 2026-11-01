"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { SegmentedControl } from "@/components/segmented-control";
import {
  FULL_HOURLY_COVERAGE,
  HOURLY_RANGE_DAYS,
} from "@/constants/chart-config";
import { useTrendData } from "@/hooks/use-chart-data";
import { usePeriodLabels } from "@/hooks/use-period-labels";
import {
  formatAxisMetric,
  formatMetric,
  formatPercent,
  METRIC_NAMES,
} from "@/lib/format";
import type { UsageView } from "@/lib/usage-view";
import type {
  ChartConfig,
  Resolution,
  TrendGroup,
  UsageMetric,
} from "@/types/chart-types";

interface UsageTrendProps {
  view: UsageView;
  metric: UsageMetric;
  deviceSeries: ChartConfig;
  // Hours are recorded per agent, so they always stack by agent
  group: TrendGroup;
  onGroupChange: (group: TrendGroup) => void;
  resolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
  timeZone: string;
}

function describe(
  view: UsageView,
  group: TrendGroup,
  resolution: Resolution,
): string {
  if (resolution === "day") {
    const days = `Per day, by ${group}.`;
    return view.hourly
      ? days
      : `${days} Hours are shown for ranges of ${HOURLY_RANGE_DAYS} days or fewer.`;
  }
  const { hourlyCoverage, totalTokens } = view.summary;
  return hourlyCoverage < FULL_HOURLY_COVERAGE && totalTokens > 0
    ? `Per hour, by agent. Hours are known for ${formatPercent(hourlyCoverage)} of tokens: agents that record when each request ran report hours; the others, and days beyond what their records keep, report whole days.`
    : "Per hour, by agent.";
}

// The metric over the period, per day or per hour
export function UsageTrend({
  view,
  metric,
  deviceSeries,
  group,
  onGroupChange,
  resolution,
  onResolutionChange,
  timeZone,
}: UsageTrendProps) {
  const { chartData, chartConfig } = useTrendData(
    view,
    deviceSeries,
    metric,
    group,
    resolution,
  );
  const labels = usePeriodLabels(resolution, timeZone);

  return (
    <Card className="h-full pt-0">
      <CardHeader className="flex flex-col gap-3 space-y-0 border-b py-5 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <CardTitle>
            {resolution === "hour" ? "Hourly" : "Daily"}{" "}
            {METRIC_NAMES[metric].noun}
          </CardTitle>
          <CardDescription>{describe(view, group, resolution)}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label="Stack by"
            value={group}
            onChange={onGroupChange}
            options={[
              { value: "agent", label: "Agent" },
              {
                value: "device",
                label: "Device",
                disabled: resolution === "hour",
              },
            ]}
          />
          <SegmentedControl
            label="Resolution"
            value={resolution}
            onChange={onResolutionChange}
            options={[
              { value: "day", label: "Day" },
              { value: "hour", label: "Hour", disabled: !view.hourly },
            ]}
          />
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[280px] w-full"
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
                  formatter={(value, name, item) => (
                    <>
                      <div
                        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: item.color }}
                      />
                      <span className="text-muted-foreground">
                        {chartConfig[String(name)]?.label ?? name}
                      </span>
                      <span className="ml-auto font-mono font-medium tabular-nums">
                        {formatMetric(metric, Number(value))}
                      </span>
                    </>
                  )}
                />
              }
            />
            {Object.entries(chartConfig).map(([key, { color }]) => (
              <Bar
                key={key}
                dataKey={key}
                stackId="usage"
                fill={color}
                maxBarSize={48}
              />
            ))}
            <ChartLegend content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
