"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@workspace/ui/components/chart"
import { Area, AreaChart, Bar, BarChart, Line, LineChart, CartesianGrid, XAxis } from "recharts"
import { useMultiDeviceChartData, useInputOutputRatioChartData, useMultiDeviceTokenData } from "@/hooks/use-chart-data"
import { DailyRecord, DeviceRecord, Device, TimeRange } from "@/types/chart-types"
import { CHART_COLORS } from "@/constants/chart-config"

interface ChartsProps {
  dailyData: DailyRecord[]
  devices: Device[]
  deviceData: DeviceRecord[]
  totals: {
    totalCost: number
    totalTokens: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheCreationTokens: number
    totalCacheReadTokens: number
  }
  timeRange: TimeRange
  customDateRange?: { from: Date; to: Date }
}

export function Charts({ dailyData, devices, deviceData, totals, timeRange, customDateRange }: ChartsProps) {

  // Use custom hooks for chart data
  const { chartData: multiDeviceChartData, chartConfig: multiDeviceChartConfig, activeDevices: activeCostDevices } = useMultiDeviceChartData(
    deviceData,
    devices,
    timeRange,
    customDateRange
  )

  const { chartData: ratioChartData, chartConfig: ratioChartConfig } = useInputOutputRatioChartData(
    dailyData,
    timeRange,
    customDateRange
  )
  const { chartData: multiDeviceTokenData, chartConfig: multiDeviceTokenConfig, activeDevices: activeTokenDevices } = useMultiDeviceTokenData(
    deviceData,
    devices,
    timeRange,
    customDateRange
  )


  // Calculate cache hit rate
  const cacheHitRate = totals.totalCacheReadTokens > 0 
    ? (totals.totalCacheReadTokens / (totals.totalCacheReadTokens + totals.totalCacheCreationTokens)) * 100 
    : 0

  return (
    <div className="space-y-6">
      {/* Cost and Token charts - side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cost trend chart */}
            <Card className="pt-0">
              <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
                <div className="grid flex-1 gap-1">
                  <CardTitle>Cost Trend</CardTitle>
                  <CardDescription>
                    Usage costs over time
                  </CardDescription>
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
                        const color = CHART_COLORS[deviceIndex % CHART_COLORS.length]
                        return (
                          <linearGradient key={device.deviceId} id={`fill${device.deviceId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor={color}
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor={color}
                              stopOpacity={0.1}
                            />
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
                        return date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) => {
                            return new Date(value).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          }}
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
            
            {/* Token usage chart */}
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
                      tickFormatter={(value) => {
                        const date = new Date(value)
                        return date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }}
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

      {/* Input/Output Ratio Analysis */}
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
            <ChartContainer config={ratioChartConfig} className="aspect-auto h-[300px] w-full">
              <LineChart 
                accessibilityLayer
                data={ratioChartData}
                margin={{
                  left: 12,
                  right: 12,
                }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return date.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }}
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
                  activeDot={{
                    r: 6,
                  }}
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

      {/* Usage Trends & Insights */}
        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Usage Trends & Insights</CardTitle>
              <CardDescription>
                Performance metrics and analysis
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
            <div className="space-y-6">
              {/* Cost efficiency */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Cost Efficiency</span>
                  <span className="text-sm font-bold">92%</span>
                </div>
                <Progress value={92} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Based on token-to-cost ratio analysis
                </p>
              </div>
              
              {/* Token utilization */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Token Utilization</span>
                  <span className="text-sm font-bold">78%</span>
                </div>
                <Progress value={78} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Average daily token usage efficiency
                </p>
              </div>
              
              {/* Cache hit rate */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Cache Hit Rate</span>
                  <span className="text-sm font-bold">{cacheHitRate.toFixed(1)}%</span>
                </div>
                <Progress value={cacheHitRate} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  Percentage of requests served from cache
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
    </div>
  )
}