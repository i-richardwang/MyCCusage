"use client"

import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@workspace/ui/components/chart"
import { Area, AreaChart, Bar, BarChart, Line, LineChart, CartesianGrid, XAxis } from "recharts"
import { useMultiDeviceChartData, useInputOutputRatioChartData, useMultiDeviceTokenData, useMultiAgentChartData, filterByTimeRange } from "@/hooks/use-chart-data"
import { DailyRecord, DeviceRecord, Device, TimeRange, ViewMode, BillingCycleRange, AgentType, AgentRecord } from "@/types/chart-types"
import { CHART_COLORS } from "@/constants/chart-config"
import type { AggregatedMetrics } from "@/types/api-types"

interface ChartsProps {
  dailyData: DailyRecord[]
  devices: Device[]
  deviceData: DeviceRecord[]
  agentData?: AgentRecord[]
  viewMode: ViewMode
  timeRange: TimeRange
  billingCycleRange: BillingCycleRange
  customDateRange?: { from: Date; to: Date }
  billingCycleDateRange?: { from: Date; to: Date }
  totals?: AggregatedMetrics
  last30Days?: AggregatedMetrics
  currentCycleMetrics?: AggregatedMetrics
  previousCycleMetrics?: AggregatedMetrics
  agentFilter?: AgentType | 'all'
}

export function Charts({
  dailyData,
  devices,
  deviceData,
  agentData,
  viewMode,
  timeRange,
  billingCycleRange,
  customDateRange,
  billingCycleDateRange,
  totals,
  last30Days,
  currentCycleMetrics,
  previousCycleMetrics,
  agentFilter = 'all'
}: ChartsProps) {
  const isBillingMode = viewMode === "billing"

  const effectiveTimeRange: TimeRange = isBillingMode ? "custom" : timeRange
  const effectiveDateRange = isBillingMode ? billingCycleDateRange : customDateRange

  const { chartData: multiDeviceChartData, chartConfig: multiDeviceChartConfig, activeDevices: activeCostDevices } = useMultiDeviceChartData(
    deviceData,
    devices,
    effectiveTimeRange,
    effectiveDateRange
  )

  const { chartData: ratioChartData, chartConfig: ratioChartConfig } = useInputOutputRatioChartData(
    dailyData,
    effectiveTimeRange,
    effectiveDateRange
  )

  const { chartData: multiDeviceTokenData, chartConfig: multiDeviceTokenConfig, activeDevices: activeTokenDevices } = useMultiDeviceTokenData(
    deviceData,
    devices,
    effectiveTimeRange,
    effectiveDateRange
  )

  // Multi-agent chart data (only when viewing all agents)
  const { chartData: multiAgentChartData, chartConfig: multiAgentChartConfig, activeAgents } = useMultiAgentChartData(
    agentData || [],
    effectiveTimeRange,
    effectiveDateRange
  )

  const showAgentChart = agentFilter === 'all' && activeAgents.length > 1

  const { usageActivityRate, cacheHitRate, tokenUnitPrice } = useMemo(() => {
    if (isBillingMode) {
      const metrics = billingCycleRange === "current" ? currentCycleMetrics : previousCycleMetrics
      if (metrics) {
        const cacheHit = metrics.totalCacheReadTokens > 0
          ? (metrics.totalCacheReadTokens / (metrics.totalCacheReadTokens + metrics.totalCacheCreationTokens)) * 100
          : 0
        const unitPrice = metrics.totalTokens > 0
          ? (metrics.totalCost / metrics.totalTokens) * 1000000
          : 0
        const filteredData = filterByTimeRange(dailyData, effectiveTimeRange, effectiveDateRange)
        const totalDays = filteredData.length || 30
        const usageActivity = (metrics.activeDays / totalDays) * 100

        return { usageActivityRate: usageActivity, cacheHitRate: cacheHit, tokenUnitPrice: unitPrice }
      }
      return { usageActivityRate: 0, cacheHitRate: 0, tokenUnitPrice: 0 }
    }

    if (timeRange === "all" && totals) {
      const cacheHit = totals.totalCacheReadTokens > 0
        ? (totals.totalCacheReadTokens / (totals.totalCacheReadTokens + totals.totalCacheCreationTokens)) * 100
        : 0
      const unitPrice = totals.totalTokens > 0
        ? (totals.totalCost / totals.totalTokens) * 1000000
        : 0
      const filteredData = filterByTimeRange(dailyData, timeRange, customDateRange)
      const usageActivity = filteredData.length > 0
        ? (filteredData.filter(day => day.totalTokens > 0).length / filteredData.length) * 100
        : 0

      return { usageActivityRate: usageActivity, cacheHitRate: cacheHit, tokenUnitPrice: unitPrice }
    }

    if (timeRange === "30d" && last30Days) {
      const cacheHit = last30Days.totalCacheReadTokens > 0
        ? (last30Days.totalCacheReadTokens / (last30Days.totalCacheReadTokens + last30Days.totalCacheCreationTokens)) * 100
        : 0
      const unitPrice = last30Days.totalTokens > 0
        ? (last30Days.totalCost / last30Days.totalTokens) * 1000000
        : 0
      const usageActivity = (last30Days.activeDays / 30) * 100

      return { usageActivityRate: usageActivity, cacheHitRate: cacheHit, tokenUnitPrice: unitPrice }
    }

    const filteredData = filterByTimeRange(dailyData, timeRange, customDateRange)

    if (filteredData.length === 0) {
      return { usageActivityRate: 0, cacheHitRate: 0, tokenUnitPrice: 0 }
    }

    const usageActivity = (filteredData.filter(day => day.totalTokens > 0).length / filteredData.length) * 100

    const aggregated = filteredData.reduce((acc, day) => ({
      cacheRead: acc.cacheRead + day.cacheReadTokens,
      cacheCreation: acc.cacheCreation + day.cacheCreationTokens,
      tokens: acc.tokens + day.totalTokens,
      cost: acc.cost + day.totalCost
    }), { cacheRead: 0, cacheCreation: 0, tokens: 0, cost: 0 })

    const cacheHit = aggregated.cacheRead > 0
      ? (aggregated.cacheRead / (aggregated.cacheRead + aggregated.cacheCreation)) * 100
      : 0

    const unitPrice = aggregated.tokens > 0
      ? (aggregated.cost / aggregated.tokens) * 1000000
      : 0

    return { usageActivityRate: usageActivity, cacheHitRate: cacheHit, tokenUnitPrice: unitPrice }
  }, [dailyData, timeRange, billingCycleRange, customDateRange, effectiveDateRange, effectiveTimeRange, totals, last30Days, currentCycleMetrics, previousCycleMetrics, isBillingMode])

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
            <ChartContainer config={multiDeviceChartConfig} className="aspect-auto h-[250px] w-full">
              <AreaChart data={multiDeviceChartData}>
                <defs>
                  {activeCostDevices.map((device, deviceIndex) => {
                    const color = CHART_COLORS[deviceIndex % CHART_COLORS.length]
                    return (
                      <linearGradient key={device.deviceId} id={`fill${device.deviceId}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={color} stopOpacity={0.1} />
                      </linearGradient>
                    )
                  })}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
              <CardDescription>Token consumption over time (millions)</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={multiDeviceTokenConfig} className="aspect-auto h-[250px] w-full">
              <BarChart data={multiDeviceTokenData}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
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
              <CardDescription>Compare usage costs across different coding agents</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={multiAgentChartConfig} className="aspect-auto h-[250px] w-full">
              <AreaChart data={multiAgentChartData}>
                <defs>
                  {activeAgents.map((agent, agentIndex) => {
                    const color = multiAgentChartConfig[agent]?.color || CHART_COLORS[agentIndex % CHART_COLORS.length]
                    return (
                      <linearGradient key={agent} id={`fillAgent${agent}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                        <stop offset="95%" stopColor={color} stopOpacity={0.1} />
                      </linearGradient>
                    )
                  })}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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

      <Card className="pt-0">
        <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
          <div className="grid flex-1 gap-1">
            <CardTitle>Input/Output Ratio Analysis</CardTitle>
            <CardDescription>Trend analysis of input vs output token efficiency over time</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          <ChartContainer config={ratioChartConfig} className="aspect-auto h-[300px] w-full">
            <LineChart accessibilityLayer data={ratioChartData} margin={{ left: 12, right: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value)
                  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
              <Line
                dataKey="ratio"
                type="monotone"
                stroke={ratioChartConfig.ratio?.color}
                strokeWidth={2}
                dot={{ fill: ratioChartConfig.ratio?.color, strokeWidth: 2, r: 4 }}
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
                <span className="text-sm font-bold">{usageActivityRate.toFixed(1)}%</span>
              </div>
              <Progress value={usageActivityRate} className="h-2" />
              <p className="text-xs text-muted-foreground">Days with usage vs total days</p>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Cache Hit Rate</span>
                <span className="text-sm font-bold">{cacheHitRate.toFixed(1)}%</span>
              </div>
              <Progress value={cacheHitRate} className="h-2" />
              <p className="text-xs text-muted-foreground">Percentage of requests served from cache</p>
            </div>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Token Unit Price</span>
                <span className="text-sm font-bold">${tokenUnitPrice.toFixed(2)}</span>
              </div>
              <Progress value={tokenUnitPrice > 0 ? Math.min(100, (6 / tokenUnitPrice) * 100) : 0} className="h-2" />
              <p className="text-xs text-muted-foreground">Average cost per million tokens</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
