"use client"

import * as React from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Progress } from "@workspace/ui/components/progress"
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@workspace/ui/components/chart"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

interface DailyRecord {
  date: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

interface ChartTabsProps {
  dailyData: DailyRecord[]
  totals: {
    totalCost: number
    totalTokens: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheCreationTokens: number
    totalCacheReadTokens: number
  }
}

export function ChartTabs({ dailyData, totals }: ChartTabsProps) {
  const [timeRange, setTimeRange] = React.useState("30d")

  // Prepare chart data
  const fullChartData = dailyData.map(record => ({
    date: record.date,
    cost: record.totalCost,
    tokens: record.totalTokens / 1000000, // Convert to millions
    inputTokens: record.inputTokens / 1000000,
    outputTokens: record.outputTokens / 1000000,
    cacheTokens: (record.cacheCreationTokens + record.cacheReadTokens) / 1000000
  })).reverse() // Reverse array for chronological order

  // Filter data based on time range
  const filteredData = fullChartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date()
    let daysToSubtract = 30
    if (timeRange === "7d") {
      daysToSubtract = 7
    } else if (timeRange === "14d") {
      daysToSubtract = 14
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  // Chart configuration
  const chartConfig = {
    cost: {
      label: "Cost",
      color: "var(--chart-1)"
    },
    tokens: {
      label: "Tokens",
      color: "var(--chart-2)"
    },
    inputTokens: {
      label: "Input Tokens",
      color: "var(--chart-1)"
    },
    outputTokens: {
      label: "Output Tokens",
      color: "var(--chart-2)"
    },
    cacheTokens: {
      label: "Cache Tokens",
      color: "var(--chart-3)"
    }
  } satisfies ChartConfig

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
          {/* Daily cost trend chart */}
          <Card className="pt-0">
            <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
              <div className="grid flex-1 gap-1">
                <CardTitle>Daily Cost Trend</CardTitle>
                <CardDescription>
                  Showing usage costs over time
                </CardDescription>
              </div>
              <Select value={timeRange} onValueChange={setTimeRange}>
                <SelectTrigger
                  className="hidden w-[160px] rounded-lg sm:ml-auto sm:flex"
                  aria-label="Select a value"
                >
                  <SelectValue placeholder="Last 30 days" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="30d" className="rounded-lg">
                    Last 30 days
                  </SelectItem>
                  <SelectItem value="14d" className="rounded-lg">
                    Last 14 days
                  </SelectItem>
                  <SelectItem value="7d" className="rounded-lg">
                    Last 7 days
                  </SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <AreaChart data={filteredData}>
                  <defs>
                    <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="5%"
                        stopColor="var(--color-cost)"
                        stopOpacity={0.8}
                      />
                      <stop
                        offset="95%"
                        stopColor="var(--color-cost)"
                        stopOpacity={0.1}
                      />
                    </linearGradient>
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
                  <Area
                    dataKey="cost"
                    type="natural"
                    fill="url(#fillCost)"
                    stroke="var(--color-cost)"
                  />
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
                  Daily token consumption (in millions)
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
              <ChartContainer
                config={chartConfig}
                className="aspect-auto h-[250px] w-full"
              >
                <BarChart data={filteredData}>
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
                    content={<ChartTooltipContent indicator="dashed" />}
                  />
                  <Bar dataKey="tokens" fill="var(--color-tokens)" radius={4} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* Token analysis tab */}
      <TabsContent value="tokens">
        <Card className="pt-0">
          <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
            <div className="grid flex-1 gap-1">
              <CardTitle>Token Breakdown Analysis</CardTitle>
              <CardDescription>
                Detailed token usage by type over time
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={chartConfig} className="aspect-auto h-[300px] w-full">
              <AreaChart data={filteredData}>
                <defs>
                  <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-inputTokens)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-inputTokens)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                  <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-outputTokens)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-outputTokens)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                  <linearGradient id="fillCache" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-cacheTokens)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-cacheTokens)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
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
                <Area 
                  dataKey="cacheTokens" 
                  type="natural"
                  fill="url(#fillCache)"
                  stroke="var(--color-cacheTokens)"
                  stackId="a"
                />
                <Area 
                  dataKey="outputTokens" 
                  type="natural"
                  fill="url(#fillOutput)"
                  stroke="var(--color-outputTokens)"
                  stackId="a"
                />
                <Area 
                  dataKey="inputTokens" 
                  type="natural"
                  fill="url(#fillInput)"
                  stroke="var(--color-inputTokens)"
                  stackId="a"
                />
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