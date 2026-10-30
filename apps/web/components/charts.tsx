"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@workspace/ui/components/chart";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  CartesianGrid,
  XAxis,
} from "recharts";
import {
  useMultiDeviceChartData,
  useInputOutputRatioChartData,
  useMultiDeviceTokenData,
  useMultiAgentChartData,
  useAgentTokenPieData,
  useAgentCostPieData,
  useDeviceCostPieData,
  useCacheEfficiencyPieData,
} from "@/hooks/use-chart-data";
import { Device, AgentType } from "@/types/chart-types";
import { CHART_COLORS } from "@/constants/chart-config";
import { formatChartDate } from "@/lib/date-utils";
import type { UsageView } from "@/lib/usage-view";

interface ChartsProps {
  view: UsageView;
  devices: Device[];
  agentFilter: AgentType | "all";
}

export function Charts({ view, devices, agentFilter }: ChartsProps) {
  const {
    chartData: multiDeviceChartData,
    chartConfig: multiDeviceChartConfig,
    activeDevices: activeCostDevices,
  } = useMultiDeviceChartData(view, devices);

  const { chartData: ratioChartData, chartConfig: ratioChartConfig } =
    useInputOutputRatioChartData(view);

  const {
    chartData: multiDeviceTokenData,
    chartConfig: multiDeviceTokenConfig,
    activeDevices: activeTokenDevices,
  } = useMultiDeviceTokenData(view, devices);

  // Multi-agent chart data (only when viewing all agents)
  const {
    chartData: multiAgentChartData,
    chartConfig: multiAgentChartConfig,
    activeAgents,
  } = useMultiAgentChartData(view);

  // Pie chart data (only when viewing all agents)
  const { chartData: agentTokenPieData, chartConfig: agentTokenPieConfig } =
    useAgentTokenPieData(view);
  const { chartData: agentCostPieData, chartConfig: agentCostPieConfig } =
    useAgentCostPieData(view);
  const { chartData: deviceCostPieData, chartConfig: deviceCostPieConfig } =
    useDeviceCostPieData(view, devices);
  const {
    chartData: cacheEfficiencyPieData,
    chartConfig: cacheEfficiencyPieConfig,
  } = useCacheEfficiencyPieData(view);

  const showAgentChart = agentFilter === "all" && activeAgents.length > 1;
  const showPieCharts = agentFilter === "all" && agentTokenPieData.length > 0;

  const { summary } = view;
  const activityPercent = summary.activityRate * 100;
  const cacheHitPercent = summary.cacheHitRate * 100;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Cost Trend</CardTitle>
              <CardDescription>Usage costs over time</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer
              config={multiDeviceChartConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <AreaChart data={multiDeviceChartData}>
                <defs>
                  {activeCostDevices.map((device, deviceIndex) => {
                    const color =
                      CHART_COLORS[deviceIndex % CHART_COLORS.length];
                    return (
                      <linearGradient
                        key={device.deviceId}
                        id={`fill${device.deviceId}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                        <stop
                          offset="95%"
                          stopColor={color}
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatChartDate(value)}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => formatChartDate(value)}
                      indicator="dot"
                    />
                  }
                />
                {activeCostDevices.map((device) => (
                  <Area
                    key={device.deviceId}
                    dataKey={device.deviceId}
                    type="natural"
                    fill={`url(#fill${device.deviceId})`}
                    stroke={multiDeviceChartConfig[device.deviceId]?.color}
                    stackId="a"
                  />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Token Usage</CardTitle>
              <CardDescription>
                Token consumption over time (millions)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer
              config={multiDeviceTokenConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <BarChart data={multiDeviceTokenData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatChartDate(value)}
                />
                <ChartTooltip
                  cursor={false}
                  content={<ChartTooltipContent hideLabel />}
                />
                <ChartLegend content={<ChartLegendContent />} />
                {activeTokenDevices.map((device, index) => (
                  <Bar
                    key={device.deviceId}
                    dataKey={device.deviceId}
                    stackId="a"
                    fill={multiDeviceTokenConfig[device.deviceId]?.color}
                    radius={
                      index === 0
                        ? [0, 0, 4, 4]
                        : index === activeTokenDevices.length - 1
                          ? [4, 4, 0, 0]
                          : [0, 0, 0, 0]
                    }
                  />
                ))}
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Agent Comparison Chart - only shown when viewing all agents and multiple agents exist */}
      {showAgentChart && (
        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Cost by Agent</CardTitle>
              <CardDescription>
                Compare usage costs across different coding agents
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer
              config={multiAgentChartConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <AreaChart data={multiAgentChartData}>
                <defs>
                  {activeAgents.map((agent, agentIndex) => {
                    const color =
                      multiAgentChartConfig[agent]?.color ||
                      CHART_COLORS[agentIndex % CHART_COLORS.length];
                    return (
                      <linearGradient
                        key={agent}
                        id={`fillAgent${agent}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                        <stop
                          offset="95%"
                          stopColor={color}
                          stopOpacity={0.1}
                        />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => formatChartDate(value)}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => formatChartDate(value)}
                      indicator="dot"
                    />
                  }
                />
                {activeAgents.map((agent) => (
                  <Area
                    key={agent}
                    dataKey={agent}
                    type="natural"
                    fill={`url(#fillAgent${agent})`}
                    stroke={multiAgentChartConfig[agent]?.color}
                    stackId="a"
                  />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Distribution Pie Charts - only shown when viewing all agents */}
      {showPieCharts && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Agent Token Distribution */}
          <Card className="pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
              <div className="grid flex-1 gap-1">
                <CardTitle>Token by Agent</CardTitle>
                <CardDescription>Distribution of token usage</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={agentTokenPieConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={agentTokenPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                  />
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                    className="-translate-y-2 flex-wrap gap-2 [&>*]:justify-center"
                  />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Agent Cost Distribution */}
          <Card className="pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
              <div className="grid flex-1 gap-1">
                <CardTitle>Cost by Agent</CardTitle>
                <CardDescription>Distribution of costs</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={agentCostPieConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={agentCostPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                  />
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                    className="-translate-y-2 flex-wrap gap-2 [&>*]:justify-center"
                  />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Device Cost Distribution */}
          <Card className="pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
              <div className="grid flex-1 gap-1">
                <CardTitle>Cost by Device</CardTitle>
                <CardDescription>Distribution across devices</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={deviceCostPieConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={deviceCostPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                  />
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                    className="-translate-y-2 flex-wrap gap-2 [&>*]:justify-center"
                  />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          {/* Cache Efficiency */}
          <Card className="pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
              <div className="grid flex-1 gap-1">
                <CardTitle>Cache Efficiency</CardTitle>
                <CardDescription>Input token cache breakdown</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={cacheEfficiencyPieConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <PieChart>
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel />}
                  />
                  <Pie
                    data={cacheEfficiencyPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                  />
                  <ChartLegend
                    content={<ChartLegendContent nameKey="name" />}
                    className="-translate-y-2 flex-wrap gap-2 [&>*]:justify-center"
                  />
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="pt-0">
        <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
          <div className="grid flex-1 gap-1">
            <CardTitle>Input/Output Ratio Analysis</CardTitle>
            <CardDescription>
              Trend analysis of input vs output token efficiency over time
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer
            config={ratioChartConfig}
            className="aspect-auto h-[300px] w-full"
          >
            <LineChart
              accessibilityLayer
              data={ratioChartData}
              margin={{ left: 12, right: 12 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => formatChartDate(value)}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="dot" />}
              />
              <Line
                dataKey="ratio"
                type="monotone"
                stroke={ratioChartConfig.ratio?.color}
                strokeWidth={2}
                dot={{
                  fill: ratioChartConfig.ratio?.color,
                  strokeWidth: 2,
                  r: 4,
                }}
                activeDot={{ r: 6 }}
              />
              <Line
                dataKey="averageRatio"
                type="monotone"
                stroke={ratioChartConfig.averageRatio?.color}
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card className="pt-0">
        <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
          <div className="grid flex-1 gap-1">
            <CardTitle>Usage Trends & Insights</CardTitle>
            <CardDescription>Performance metrics and analysis</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Usage Activity</span>
                <span className="text-sm font-bold">
                  {activityPercent.toFixed(1)}%
                </span>
              </div>
              <Progress value={activityPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Days with usage vs total days
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Cache Hit Rate</span>
                <span className="text-sm font-bold">
                  {cacheHitPercent.toFixed(1)}%
                </span>
              </div>
              <Progress value={cacheHitPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                Percentage of requests served from cache
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Token Unit Price</span>
                <span className="text-sm font-bold">
                  ${summary.costPerMillionTokens.toFixed(2)}
                </span>
              </div>
              <Progress
                value={
                  summary.costPerMillionTokens > 0
                    ? Math.min(100, (6 / summary.costPerMillionTokens) * 100)
                    : 0
                }
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">
                Average cost per million tokens
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
