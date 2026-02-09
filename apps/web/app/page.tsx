"use client"

import { useState, useCallback, useMemo } from "react"
import { useUsageStats } from "@/hooks/use-usage-stats"
import { StatsCards } from "@/components/stats-cards"
import { PlanComparison } from "@/components/plan-comparison"
import { Charts } from "@/components/charts"
import { RecentActivity } from "@/components/recent-activity"
import { GlobalFilterBar } from "@/components/global-filter-bar"
import { ModeToggle } from "@/components/mode-toggle"
import { Footer } from "@/components/footer"
import { DailyRecord, TimeRange, AgentType } from "@/types/chart-types"
import { type DateRange } from "react-day-picker"
import { filterByTimeRange, filterByAgent } from "@/hooks/use-chart-data"
import type { AggregatedMetrics } from "@/types/api-types"
import { Loader2 } from "lucide-react"

// Aggregate DailyRecord[] into AggregatedMetrics
function aggregateFromDaily(data: DailyRecord[]): AggregatedMetrics {
  if (data.length === 0) {
    return {
      totalCost: 0, totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0,
      totalCacheCreationTokens: 0, totalCacheReadTokens: 0, activeDays: 0, avgDailyCost: 0
    }
  }
  const totalCost = data.reduce((sum, r) => sum + r.totalCost, 0)
  const totalTokens = data.reduce((sum, r) => sum + r.totalTokens, 0)
  const totalInputTokens = data.reduce((sum, r) => sum + r.inputTokens, 0)
  const totalOutputTokens = data.reduce((sum, r) => sum + r.outputTokens, 0)
  const totalCacheCreationTokens = data.reduce((sum, r) => sum + r.cacheCreationTokens, 0)
  const totalCacheReadTokens = data.reduce((sum, r) => sum + r.cacheReadTokens, 0)
  const activeDays = data.filter(r => r.totalTokens > 0).length
  const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0
  return { totalCost, totalTokens, totalInputTokens, totalOutputTokens, totalCacheCreationTokens, totalCacheReadTokens, activeDays, avgDailyCost }
}

export default function Page() {
  const { stats, loading, error } = useUsageStats()

  const [timeRange, setTimeRange] = useState<TimeRange>("30d")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)
  const [agentFilter, setAgentFilter] = useState<AgentType | 'all'>('all')

  const getDateRangeFromTimeRange = useCallback((range: TimeRange): DateRange | undefined => {
    if (range === "all" || range === "custom") return undefined

    const today = new Date()
    const days = range === "7d" ? 7 : range === "14d" ? 14 : 30
    const from = new Date(today)
    from.setDate(from.getDate() - days)

    return { from, to: today }
  }, [])

  const handleTimeRangeChange = useCallback((newTimeRange: TimeRange) => {
    setTimeRange(newTimeRange)
    const correspondingDateRange = getDateRangeFromTimeRange(newTimeRange)
    setDateRange(correspondingDateRange)
  }, [getDateRangeFromTimeRange])

  const handleDateRangeChange = useCallback((newDateRange: DateRange | undefined) => {
    setDateRange(newDateRange)
    if (newDateRange?.from && newDateRange?.to) {
      setTimeRange("custom")
    }
  }, [])

  const handleAgentFilterChange = useCallback((agent: AgentType | 'all') => {
    setAgentFilter(agent)
  }, [])

  const customDateRange = useMemo(() => {
    return dateRange?.from && dateRange?.to
      ? { from: dateRange.from, to: dateRange.to }
      : undefined
  }, [dateRange?.from, dateRange?.to])

  // Filter data by agent type
  // Note: stats.daily has NO agentType field (aggregated by date only),
  // so we use stats.agentData (grouped by date+agentType) for per-agent filtering
  const filteredDailyByAgent = useMemo((): DailyRecord[] => {
    if (!stats) return []
    if (agentFilter === 'all') {
      return stats.daily || []
    }
    return (stats.agentData || []).filter(r => r.agentType === agentFilter)
  }, [stats, agentFilter])

  const filteredDeviceDataByAgent = useMemo(() => {
    if (!stats?.deviceData) return []
    return filterByAgent(stats.deviceData, agentFilter)
  }, [stats?.deviceData, agentFilter])

  const availableAgents = useMemo(() => {
    return stats?.availableAgents || ['claude-code'] as AgentType[]
  }, [stats?.availableAgents])

  const filteredMetrics = useMemo((): AggregatedMetrics | undefined => {
    if (!filteredDailyByAgent || filteredDailyByAgent.length === 0) return undefined

    // For 'all' agent filter, use API pre-computed metrics when available
    if (agentFilter === 'all') {
      if (timeRange === "all" && stats?.totals) return stats.totals
      if (timeRange === "30d" && stats?.last30Days) return stats.last30Days
    }

    // Calculate from filtered data for all other cases
    const dataToAggregate = filterByTimeRange(filteredDailyByAgent, timeRange, customDateRange)
    return aggregateFromDaily(dataToAggregate)
  }, [stats, filteredDailyByAgent, timeRange, customDateRange, agentFilter])

  const renderMainContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-red-500">Error: {error}</div>
        </div>
      )
    }

    if (!stats) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-lg">No data available</div>
        </div>
      )
    }

    return (
      <>
        <GlobalFilterBar
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          agentFilter={agentFilter}
          onAgentFilterChange={handleAgentFilterChange}
          availableAgents={availableAgents}
        />

        <PlanComparison
          cumulativeData={stats.cumulative}
          billingStartDate={stats.billingStartDate}
          filteredMetrics={filteredMetrics}
          isAllTime={timeRange === "all"}
        />

        <StatsCards
          dailyData={filteredDailyByAgent}
          timeRange={timeRange}
          customDateRange={customDateRange}
          totals={agentFilter === 'all' ? stats.totals : undefined}
          last30Days={agentFilter === 'all' ? stats.last30Days : undefined}
        />

        <Charts
          dailyData={filteredDailyByAgent}
          devices={stats.devices}
          deviceData={filteredDeviceDataByAgent}
          agentData={stats.agentData}
          timeRange={timeRange}
          customDateRange={customDateRange}
          totals={agentFilter === 'all' ? stats.totals : undefined}
          last30Days={agentFilter === 'all' ? stats.last30Days : undefined}
          agentFilter={agentFilter}
        />

        <RecentActivity
          dailyData={filteredDailyByAgent}
          timeRange={timeRange}
          customDateRange={customDateRange}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                {process.env.NEXT_PUBLIC_OWNER_NAME
                  ? `${process.env.NEXT_PUBLIC_OWNER_NAME}'s Coding Usage Dashboard`
                  : "Coding Usage Dashboard"
                }
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <ModeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        {renderMainContent()}
      </div>

      <Footer />
    </div>
  )
}
