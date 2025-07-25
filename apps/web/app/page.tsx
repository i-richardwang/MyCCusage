"use client"

import { useState, useCallback } from "react"
import { useUsageStats } from "@/hooks/use-usage-stats"
import { StatsCards } from "@/components/stats-cards"
import { PlanComparison } from "@/components/plan-comparison"
import { Charts } from "@/components/chart-tabs"
import { RecentActivity } from "@/components/recent-activity"
import { FilterBar } from "@/components/filter-bar"
import { ModeToggle } from "@/components/mode-toggle"
import { Footer } from "@/components/footer"
import { TimeRange } from "@/types/chart-types"
import { type DateRange } from "react-day-picker"
import { Loader2 } from "lucide-react"

export default function Page() {
  const { stats, loading, error } = useUsageStats()
  const [timeRange, setTimeRange] = useState<TimeRange>("all")
  const [dateRange, setDateRange] = useState<DateRange | undefined>(undefined)

  // Helper function to calculate date range from preset time range
  const getDateRangeFromTimeRange = useCallback((range: TimeRange): DateRange | undefined => {
    if (range === "all" || range === "custom") return undefined
    
    const today = new Date()
    const days = range === "7d" ? 7 : range === "14d" ? 14 : 30
    const from = new Date(today)
    from.setDate(from.getDate() - days)
    
    return { from, to: today }
  }, [])

  // Handle time range change from dropdown
  const handleTimeRangeChange = useCallback((newTimeRange: TimeRange) => {
    setTimeRange(newTimeRange)
    // Always update dateRange to show corresponding dates for preset ranges
    const correspondingDateRange = getDateRangeFromTimeRange(newTimeRange)
    setDateRange(correspondingDateRange)
  }, [getDateRangeFromTimeRange])

  // Handle custom date range change from picker
  const handleDateRangeChange = useCallback((newDateRange: DateRange | undefined) => {
    setDateRange(newDateRange)
    // Only switch to custom if user actually selected a valid date range
    if (newDateRange?.from && newDateRange?.to) {
      setTimeRange("custom")
    }
  }, [])

  // Convert DateRange to the format expected by filter functions
  const customDateRange = dateRange?.from && dateRange?.to 
    ? { from: dateRange.from, to: dateRange.to }
    : undefined


  // Loading/Error content for main area
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
        {/* Plan comparison section */}
        <PlanComparison 
          currentCycleCost={stats.currentCycle.totalCost}
          previousCycleCost={stats.previousCycle.totalCost}
          billingCycleLabel={stats.billingCycle.label}
          daysRemaining={stats.billingCycle.daysRemaining}
          cumulativeData={stats.cumulative}
          billingStartDate={stats.billingCycle.startDateConfig}
          last30DaysData={stats.last30Days}
        />

        {/* Global filter bar */}
        <FilterBar 
          timeRange={timeRange}
          onTimeRangeChange={handleTimeRangeChange}
          dateRange={dateRange}
          onDateRangeChange={handleDateRangeChange}
        />

        {/* Statistics cards section */}
        <StatsCards
          dailyData={stats.daily}
          timeRange={timeRange}
          customDateRange={customDateRange}
        />

        {/* Charts section */}
        <Charts 
          dailyData={stats.daily} 
          devices={stats.devices} 
          deviceData={stats.deviceData} 
          timeRange={timeRange}
          customDateRange={customDateRange}
        />

        {/* Recent activity table section */}
        <RecentActivity 
          dailyData={stats.daily} 
          timeRange={timeRange}
          customDateRange={customDateRange}
        />
      </>
    )
  }

  return (
    <div className="min-h-screen">
      {/* Header navigation */}
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

      {/* Main content area */}
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        {renderMainContent()}
      </div>

      {/* Footer */}
      <Footer />
    </div>
  )
}
