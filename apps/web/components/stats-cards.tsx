"use client"

import { useMemo } from "react"
import { Card, CardContent } from "@workspace/ui/components/card"
import { DollarSign, Cpu, TrendingUp } from "lucide-react"
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
        avgDailyCost: 0
      }
    }

    const totalCost = filteredData.reduce((sum, record) => sum + record.totalCost, 0)
    const totalTokens = filteredData.reduce((sum, record) => sum + record.totalTokens, 0)
    const activeDays = filteredData.length
    const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0

    return {
      totalCost,
      totalTokens,
      avgDailyCost
    }
  }, [dailyData, timeRange, customDateRange])

  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(4)}`
  }

  const formatTokens = (tokens: number) => {
    const tokensInMillions = tokens / 1000000
    return `${tokensInMillions.toFixed(1)}M`
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Total Cost */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total Cost</p>
              <p className="text-2xl font-bold">{formatCurrency(stats.totalCost)}</p>
              <p className="text-xs text-muted-foreground">
                Cumulative usage cost
              </p>
            </div>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {/* Total Tokens */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total Tokens</p>
              <p className="text-2xl font-bold">{formatTokens(stats.totalTokens)}</p>
              <p className="text-xs text-muted-foreground">
                Total usage volume
              </p>
            </div>
            <Cpu className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {/* Average Daily Cost */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Average Daily Cost</p>
              <p className="text-2xl font-bold">{formatCurrency(stats.avgDailyCost)}</p>
              <p className="text-xs text-muted-foreground">
                Daily average analysis
              </p>
            </div>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

    </div>
  )
}