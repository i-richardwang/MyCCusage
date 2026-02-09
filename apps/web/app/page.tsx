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
import { TimeRange, ViewMode, BillingCycleRange, AgentType } from "@/types/chart-types"
import { type DateRange } from "react-day-picker"
import { filterByTimeRange, filterByAgent } from "@/hooks/use-chart-data"
import { Loader2 } from "lucide-react"

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
  const filteredDailyByAgent = useMemo(() => {
    if (!stats?.daily) return []
    return filterByAgent(stats.daily, agentFilter)
  }, [stats?.daily, agentFilter])

  const filteredDeviceDataByAgent = useMemo(() => {
    if (!stats?.deviceData) return []
    return filterByAgent(stats.deviceData, agentFilter)
  }, [stats?.deviceData, agentFilter])

  const availableAgents = useMemo(() => {
    return stats?.availableAgents || ['claude-code'] as AgentType[]
  }, [stats?.availableAgents])

  const filteredMetrics = useMemo(() => {
    if (!filteredDailyByAgent || filteredDailyByAgent.length === 0) return undefined
    if (viewMode === "billing") return undefined

    // For agent-filtered data, always calculate from filtered data
    if (agentFilter !== 'all') {
      const filteredData = filterByTimeRange(filteredDailyByAgent, timeRange, customDateRange)
      if (filteredData.length === 0) {
        return {
          totalCost: 0,
          totalTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          activeDays: 0,
          avgDailyCost: 0
        }
      }

      const totalCost = filteredData.reduce((sum, r) => sum + r.totalCost, 0)
      const totalTokens = filteredData.reduce((sum, r) => sum + r.totalTokens, 0)
      const totalInputTokens = filteredData.reduce((sum, r) => sum + r.inputTokens, 0)
      const totalOutputTokens = filteredData.reduce((sum, r) => sum + r.outputTokens, 0)
      const totalCacheCreationTokens = filteredData.reduce((sum, r) => sum + r.cacheCreationTokens, 0)
      const totalCacheReadTokens = filteredData.reduce((sum, r) => sum + r.cacheReadTokens, 0)
      const activeDays = filteredData.filter(r => r.totalTokens > 0).length
      const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0

      return {
        totalCost,
        totalTokens,
        totalInputTokens,
        totalOutputTokens,
        totalCacheCreationTokens,
        totalCacheReadTokens,
        activeDays,
        avgDailyCost
      }
    }

    // Original logic for "all" agent filter
    if (timeRange === "all" && stats?.totals) {
      return stats.totals
    }
    if (timeRange === "30d" && stats?.last30Days) {
      return stats.last30Days
    }

    const filteredData = filterByTimeRange(filteredDailyByAgent, timeRange, customDateRange)
    if (filteredData.length === 0) {
      return {
        totalCost: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        activeDays: 0,
        avgDailyCost: 0
      }
    }

    const totalCost = filteredData.reduce((sum, r) => sum + r.totalCost, 0)
    const totalTokens = filteredData.reduce((sum, r) => sum + r.totalTokens, 0)
    const totalInputTokens = filteredData.reduce((sum, r) => sum + r.inputTokens, 0)
    const totalOutputTokens = filteredData.reduce((sum, r) => sum + r.outputTokens, 0)
    const totalCacheCreationTokens = filteredData.reduce((sum, r) => sum + r.cacheCreationTokens, 0)
    const totalCacheReadTokens = filteredData.reduce((sum, r) => sum + r.cacheReadTokens, 0)
    const activeDays = filteredData.filter(r => r.totalTokens > 0).length
    const avgDailyCost = activeDays > 0 ? totalCost / activeDays : 0

    return {
      totalCost,
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      activeDays,
      avgDailyCost
    }
  }, [stats, filteredDailyByAgent, viewMode, timeRange, customDateRange, agentFilter])

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
          currentCycleCost={stats.currentCycle.totalCost}
          previousCycleCost={stats.previousCycle.totalCost}
          currentCycleMetrics={stats.currentCycle}
          previousCycleMetrics={stats.previousCycle}
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
          totals={stats.totals}
          last30Days={stats.last30Days}
          currentCycleMetrics={stats.currentCycle}
          previousCycleMetrics={stats.previousCycle}
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
          totals={stats.totals}
          last30Days={stats.last30Days}
          currentCycleMetrics={stats.currentCycle}
          previousCycleMetrics={stats.previousCycle}
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
