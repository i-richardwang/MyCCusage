"use client"

import { useMemo } from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Cpu, TrendingUp, Activity, Database } from "lucide-react"
import { DailyRecord, TimeRange, ViewMode, BillingCycleRange } from "@/types/chart-types"
import { filterByTimeRange } from "@/hooks/use-chart-data"
import type { AggregatedMetrics } from "@/types/api-types"

interface StatsCardsProps {
  dailyData: DailyRecord[]
  viewMode: ViewMode
  timeRange: TimeRange
  billingCycleRange: BillingCycleRange
  customDateRange?: { from: Date; to: Date }
  totals?: AggregatedMetrics
  last30Days?: AggregatedMetrics
  currentCycleMetrics?: AggregatedMetrics
  previousCycleMetrics?: AggregatedMetrics
}

export function StatsCards({
  dailyData,
  viewMode,
  timeRange,
  billingCycleRange,
  customDateRange,
  totals,
  last30Days,
  currentCycleMetrics,
  previousCycleMetrics
}: StatsCardsProps) {
  const stats = useMemo(() => {
    if (viewMode === "billing") {
      const metrics = billingCycleRange === "current" ? currentCycleMetrics : previousCycleMetrics
      if (metrics) {
        return {
          totalTokens: metrics.totalTokens,
          cachedTokens: metrics.totalCacheReadTokens,
          avgDailyCost: metrics.avgDailyCost,
          avgDailyTokens: metrics.activeDays > 0 ? metrics.totalTokens / metrics.activeDays : 0
        }
      }
      return { totalTokens: 0, cachedTokens: 0, avgDailyCost: 0, avgDailyTokens: 0 }
    }

    if (timeRange === "all" && totals) {
      return {
        totalTokens: totals.totalTokens,
        cachedTokens: totals.totalCacheReadTokens,
        avgDailyCost: totals.avgDailyCost,
        avgDailyTokens: totals.activeDays > 0 ? totals.totalTokens / totals.activeDays : 0
      }
    }

    if (timeRange === "30d" && last30Days) {
      return {
        totalTokens: last30Days.totalTokens,
        cachedTokens: last30Days.totalCacheReadTokens,
        avgDailyCost: last30Days.avgDailyCost,
        avgDailyTokens: last30Days.activeDays > 0 ? last30Days.totalTokens / last30Days.activeDays : 0
      }
    }

    const filteredData = filterByTimeRange(dailyData, timeRange, customDateRange)
    
    if (filteredData.length === 0) {
      return { totalTokens: 0, cachedTokens: 0, avgDailyCost: 0, avgDailyTokens: 0 }
    }

    const totalTokens = filteredData.reduce((sum, record) => sum + record.totalTokens, 0)
    const cachedTokens = filteredData.reduce((sum, record) => sum + record.cacheReadTokens, 0)
    const totalCost = filteredData.reduce((sum, record) => sum + record.totalCost, 0)
    const activeDays = filteredData.length
    const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0
    const avgDailyTokens = activeDays > 0 ? totalTokens / activeDays : 0

    return { totalTokens, cachedTokens, avgDailyCost, avgDailyTokens }
  }, [dailyData, viewMode, timeRange, billingCycleRange, customDateRange, totals, last30Days, currentCycleMetrics, previousCycleMetrics])

  const formatCurrency = (amount: number) => `$${amount.toFixed(2)}`
  const formatTokens = (tokens: number) => `${(tokens / 1000000).toFixed(1)}M`

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Total Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(stats.totalTokens)}</CardTitle>
              <CardDescription>Total usage volume</CardDescription>
            </div>
            <Cpu className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Cached Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(stats.cachedTokens)}</CardTitle>
              <CardDescription>Tokens served from cache</CardDescription>
            </div>
            <Database className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Average Daily Cost</CardDescription>
              <CardTitle className="text-3xl">{formatCurrency(stats.avgDailyCost)}</CardTitle>
              <CardDescription>Daily average analysis</CardDescription>
            </div>
            <TrendingUp className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Average Daily Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(stats.avgDailyTokens)}</CardTitle>
              <CardDescription>Daily token processing rate</CardDescription>
            </div>
            <Activity className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
