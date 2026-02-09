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
import { DailyRecord, TimeRange, ViewMode, BillingCycleRange, AgentType } from "@/types/chart-types"
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

  const [viewMode, setViewMode] = useState<ViewMode>("rolling")
  const [timeRange, setTimeRange] = useState<TimeRange>("30d")
  const [billingCycleRange, setBillingCycleRange] = useState<BillingCycleRange>("current")
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

  const handleViewModeChange = useCallback((newViewMode: ViewMode) => {
    setViewMode(newViewMode)
    if (newViewMode === "rolling") {
      setTimeRange("30d")
      setDateRange(getDateRangeFromTimeRange("30d"))
    } else {
      setBillingCycleRange("current")
    }
  }, [getDateRangeFromTimeRange])

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

  const handleBillingCycleRangeChange = useCallback((range: BillingCycleRange) => {
    setBillingCycleRange(range)
  }, [])

  const handleAgentFilterChange = useCallback((agent: AgentType | 'all') => {
    setAgentFilter(agent)
  }, [])

  const customDateRange = useMemo(() => {
    return dateRange?.from && dateRange?.to 
      ? { from: dateRange.from, to: dateRange.to }
      : undefined
  }, [dateRange?.from, dateRange?.to])

  const billingCycleDates = useMemo(() => {
    if (!stats?.billingCycle) return { current: undefined, previous: undefined }
    
    const currentStart = new Date(stats.billingCycle.startDate)
    const currentEnd = new Date(stats.billingCycle.endDate)
    
    const previousEnd = new Date(currentStart)
    previousEnd.setDate(previousEnd.getDate() - 1)
    const previousStart = new Date(previousEnd)
    previousStart.setMonth(previousStart.getMonth() - 1)
    previousStart.setDate(previousStart.getDate() + 1)
    
    return {
      current: { from: currentStart, to: currentEnd },
      previous: { from: previousStart, to: previousEnd }
    }
  }, [stats?.billingCycle])

  const activeBillingCycleDateRange = billingCycleRange === "current"
    ? billingCycleDates.current
    : billingCycleDates.previous

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
      if (viewMode === "billing") {
        return billingCycleRange === "current" ? stats?.currentCycle : stats?.previousCycle
      }
      if (timeRange === "all" && stats?.totals) return stats.totals
      if (timeRange === "30d" && stats?.last30Days) return stats.last30Days
    }

    // Calculate from filtered data for all other cases
    let dataToAggregate: DailyRecord[]
    if (viewMode === "billing") {
      const billingRange = billingCycleRange === "current"
        ? billingCycleDates.current
        : billingCycleDates.previous
      dataToAggregate = billingRange
        ? filterByTimeRange(filteredDailyByAgent, "custom", billingRange)
        : filteredDailyByAgent
    } else {
      dataToAggregate = filterByTimeRange(filteredDailyByAgent, timeRange, customDateRange)
    }

    return aggregateFromDaily(dataToAggregate)
  }, [stats, filteredDailyByAgent, viewMode, timeRange, customDateRange, agentFilter, billingCycleRange, billingCycleDates])

  // Compute effective current/previous cycle metrics (filtered by agent when needed)
  const currentCycleEffective = useMemo((): AggregatedMetrics | undefined => {
    if (agentFilter === 'all') return stats?.currentCycle
    if (!filteredDailyByAgent?.length || !billingCycleDates.current) return undefined
    const data = filterByTimeRange(filteredDailyByAgent, "custom", billingCycleDates.current)
    return aggregateFromDaily(data)
  }, [agentFilter, filteredDailyByAgent, billingCycleDates.current, stats?.currentCycle])

  const previousCycleEffective = useMemo((): AggregatedMetrics | undefined => {
    if (agentFilter === 'all') return stats?.previousCycle
    if (!filteredDailyByAgent?.length || !billingCycleDates.previous) return undefined
    const data = filterByTimeRange(filteredDailyByAgent, "custom", billingCycleDates.previous)
    return aggregateFromDaily(data)
  }, [agentFilter, filteredDailyByAgent, billingCycleDates.previous, stats?.previousCycle])

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
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          billingCycleRange={billingCycleRange}
          onBillingCycleRangeChange={handleBillingCycleRangeChange}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
          agentFilter={agentFilter}
          onAgentFilterChange={handleAgentFilterChange}
          availableAgents={availableAgents}
        />

        <PlanComparison
          viewMode={viewMode}
          billingCycleRange={billingCycleRange}
          currentCycleCost={currentCycleEffective?.totalCost ?? 0}
          previousCycleCost={previousCycleEffective?.totalCost ?? 0}
          currentCycleMetrics={currentCycleEffective}
          previousCycleMetrics={previousCycleEffective}
          billingCycleLabel={stats.billingCycle.label}
          daysRemaining={stats.billingCycle.daysRemaining}
          cumulativeData={stats.cumulative}
          billingStartDate={stats.billingCycle.startDateConfig}
          filteredMetrics={filteredMetrics}
          isAllTime={timeRange === "all"}
        />

        <StatsCards
          dailyData={filteredDailyByAgent}
          viewMode={viewMode}
          timeRange={timeRange}
          billingCycleRange={billingCycleRange}
          customDateRange={customDateRange}
          totals={agentFilter === 'all' ? stats.totals : undefined}
          last30Days={agentFilter === 'all' ? stats.last30Days : undefined}
          currentCycleMetrics={currentCycleEffective}
          previousCycleMetrics={previousCycleEffective}
        />

        <Charts
          dailyData={filteredDailyByAgent}
          devices={stats.devices}
          deviceData={filteredDeviceDataByAgent}
          agentData={stats.agentData}
          viewMode={viewMode}
          timeRange={timeRange}
          billingCycleRange={billingCycleRange}
          customDateRange={customDateRange}
          billingCycleDateRange={activeBillingCycleDateRange}
          totals={agentFilter === 'all' ? stats.totals : undefined}
          last30Days={agentFilter === 'all' ? stats.last30Days : undefined}
          currentCycleMetrics={currentCycleEffective}
          previousCycleMetrics={previousCycleEffective}
          agentFilter={agentFilter}
        />

        <RecentActivity
          dailyData={filteredDailyByAgent}
          viewMode={viewMode}
          timeRange={timeRange}
          billingCycleRange={billingCycleRange}
          customDateRange={customDateRange}
          billingCycleDateRange={activeBillingCycleDateRange}
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
                  ? `${process.env.NEXT_PUBLIC_OWNER_NAME}'s Claude Code Usage Dashboard`
                  : "Claude Code Usage Dashboard"
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
