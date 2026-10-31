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
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@workspace/ui/components/chart";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { useHourlyChartData } from "@/hooks/use-chart-data";
import {
  FULL_HOURLY_COVERAGE,
  HOURLY_RANGE_DAYS,
} from "@/constants/chart-config";
import type { UsageView } from "@/lib/usage-view";

interface HourlyUsageProps {
  view: UsageView;
  // Account time zone, which hours are shown in
  timeZone: string;
}

export function HourlyUsage({ view, timeZone }: HourlyUsageProps) {
  const data = useHourlyChartData(view);
  const coverage = view.summary.hourlyCoverage;

  const { tick, label } = useMemo(
    () => ({
      tick: new Intl.DateTimeFormat("en-US", {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        hourCycle: "h23",
      }),
      label: new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    }),
    [timeZone],
  );

  const description = !data
    ? `Choose ${HOURLY_RANGE_DAYS} days or fewer to see usage hour by hour`
    : coverage < FULL_HOURLY_COVERAGE && view.summary.totalTokens > 0
      ? `Hours are known for ${(coverage * 100).toFixed(0)}% of tokens in this period. Agents that record when each request ran report hours; the others, and days beyond what their records keep, report whole days.`
      : "Tokens per hour, in millions";

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Hourly Usage</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      {data && data.activeAgents.length > 0 && (
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer
            config={data.chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <BarChart data={data.chartData}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="hourStart"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={48}
                tickFormatter={(value) => tick.format(new Date(value))}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => label.format(new Date(value))}
                    formatter={(value, name, item) => (
                      <>
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-muted-foreground">
                          {data.chartConfig[String(name)]?.label ?? name}
                        </span>
                        <span className="ml-auto font-mono font-medium tabular-nums">
                          {Number(value).toFixed(2)}M
                        </span>
                      </>
                    )}
                  />
                }
              />
              {data.activeAgents.map((agent) => (
                <Bar
                  key={agent}
                  dataKey={agent}
                  stackId="a"
                  fill={data.chartConfig[agent]?.color}
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      )}
    </Card>
  );
}
