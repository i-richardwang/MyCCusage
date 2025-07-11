"use client"

import { useMemo } from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { DollarSign, Cpu, TrendingUp, Activity } from "lucide-react"
import { DailyRecord, TimeRange } from "@/types/chart-types"
import { filterByTimeRange } from "@/hooks/use-chart-data"

interface StatsCardsProps {
  dailyData: DailyRecord[]
  timeRange: TimeRange
  customDateRange?: { from: Date; to: Date }
}

export function StatsCards({ dailyData, timeRange, customDateRange }: StatsCardsProps) {
  // Dynamic calculation based on time range
  const stats = useMemo(() => {
    const filteredData = filterByTimeRange(dailyData, timeRange, customDateRange)
    
    if (filteredData.length === 0) {
      return {
        totalCost: 0,
        totalTokens: 0,
        avgDailyCost: 0,
        avgDailyTokens: 0
      }
    }

    const totalCost = filteredData.reduce((sum, record) => sum + record.totalCost, 0)
    const totalTokens = filteredData.reduce((sum, record) => sum + record.totalTokens, 0)
    const activeDays = filteredData.length
    const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0
    const avgDailyTokens = activeDays > 0 ? totalTokens / activeDays : 0

    return {
      totalCost,
      totalTokens,
      avgDailyCost,
      avgDailyTokens
    }
  }, [dailyData, timeRange, customDateRange])

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  const formatTokens = (tokens: number) => {
    const tokensInMillions = tokens / 1000000
    return `${tokensInMillions.toFixed(1)}M`
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {/* Total Cost */}
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Total Cost</CardDescription>
              <CardTitle className="text-3xl">{formatCurrency(stats.totalCost)}</CardTitle>
              <CardDescription>
                Cumulative usage cost
              </CardDescription>
            </div>
            <DollarSign className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      {/* Total Tokens */}
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Total Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(stats.totalTokens)}</CardTitle>
              <CardDescription>
                Total usage volume
              </CardDescription>
            </div>
            <Cpu className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      {/* Average Daily Cost */}
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Average Daily Cost</CardDescription>
              <CardTitle className="text-3xl">{formatCurrency(stats.avgDailyCost)}</CardTitle>
              <CardDescription>
                Daily average analysis
              </CardDescription>
            </div>
            <TrendingUp className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      {/* Average Daily Tokens */}
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Average Daily Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(stats.avgDailyTokens)}</CardTitle>
              <CardDescription>
                Daily token processing rate
              </CardDescription>
            </div>
            <Activity className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

    </div>
  )
}