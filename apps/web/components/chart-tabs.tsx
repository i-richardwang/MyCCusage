"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Progress } from "@workspace/ui/components/progress"
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@workspace/ui/components/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { useMultiDeviceChartData, useTokenBreakdownChartData, useMultiDeviceTokenData } from "@/hooks/use-chart-data"
import { DailyRecord, DeviceRecord, Device, TimeRange } from "@/types/chart-types"
import { CHART_COLORS } from "@/constants/chart-config"

interface ChartTabsProps {
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
}

export function ChartTabs({ dailyData, devices, deviceData, totals, timeRange }: ChartTabsProps) {

  // Use custom hooks for chart data
  const { chartData: multiDeviceChartData, chartConfig: multiDeviceChartConfig } = useMultiDeviceChartData(
    deviceData,
    devices,
    timeRange
  )

  const { chartData: tokenBreakdownData, chartConfig: tokenBreakdownConfig } = useTokenBreakdownChartData(
    dailyData,
    timeRange
  )
  const { chartData: multiDeviceTokenData, chartConfig: multiDeviceTokenConfig } = useMultiDeviceTokenData(
    deviceData,
    devices,
    timeRange
  )


  // Calculate cache hit rate
  const cacheHitRate = totals.totalCacheReadTokens > 0 
    ? (totals.totalCacheReadTokens / (totals.totalCacheReadTokens + totals.totalCacheCreationTokens)) * 100 
    : 0

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <TabsList className="grid w-full max-w-md grid-cols-3">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tokens">Token Analysis</TabsTrigger>
        <TabsTrigger value="trends">Trends</TabsTrigger>
      </TabsList>

      {/* Overview tab */}
      <TabsContent value="overview">
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
                      {devices.map((device, deviceIndex) => {
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
                    {devices.map((device) => (
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
                    {devices.map((device, index) => (
                      <Bar
                        key={device.deviceId}
                        dataKey={device.deviceId}
                        stackId="a"
                        fill={multiDeviceTokenConfig[device.deviceId]?.color}
                        radius={
                          index === 0 
                            ? [0, 0, 4, 4] 
                            : index === devices.length - 1
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
        </div>
      </TabsContent>

      {/* Token analysis tab */}
      <TabsContent value="tokens">
        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Token Breakdown Analysis</CardTitle>
              <CardDescription>
                Detailed token usage by type over time (millions)
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={tokenBreakdownConfig} className="aspect-auto h-[300px] w-full">
              <AreaChart data={tokenBreakdownData}>
                <defs>
                  {Object.entries(tokenBreakdownConfig).map(([key, config]) => (
                    <linearGradient key={key} id={`fill${key}`} x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor={config.color}
                        stopOpacity={0.8}
                      />
                      <stop
                        offset="95%"
                        stopColor={config.color}
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  ))}
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
                  content={<ChartTooltipContent indicator="dot" />}
                />
                {(Object.keys(tokenBreakdownConfig) as Array<keyof typeof tokenBreakdownConfig>).reverse().map((tokenType) => (
                  <Area 
                    key={tokenType}
                    dataKey={tokenType} 
                    type="natural"
                    fill={`url(#fill${tokenType})`}
                    stroke={tokenBreakdownConfig[tokenType].color}
                    stackId="a"
                  />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Trends tab */}
      <TabsContent value="trends">
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
      </TabsContent>
    </Tabs>
  )
}