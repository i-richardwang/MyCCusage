"use client"

import { useUsageStats } from "@/hooks/use-usage-stats"
import { StatsCards } from "@/components/stats-cards"
import { PlanComparison } from "@/components/plan-comparison"
import { ChartTabs } from "@/components/chart-tabs"
import { RecentActivity } from "@/components/recent-activity"

export default function Page() {
  const { stats, loading, error } = useUsageStats()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-svh">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-svh">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center min-h-svh">
        <div className="text-lg">No data available</div>
      </div>
    )
  }


  return (
    <div className="min-h-screen">
      {/* Header navigation */}
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Claude Code Usage Monitor</h1>
              <p className="text-sm text-muted-foreground">Monitor your Claude API usage statistics</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Statistics cards section */}
        <StatsCards
          totalCost={stats.totals.totalCost}
          totalTokens={stats.totals.totalTokens}
          avgDailyCost={stats.totals.avgDailyCost}
          activeDays={stats.totals.recordCount}
        />

        {/* Plan comparison section */}
        <PlanComparison 
          currentCycleCost={stats.currentCycle.totalCost}
          billingCycleLabel={stats.billingCycle.label}
          daysRemaining={stats.billingCycle.daysRemaining}
        />

        {/* Chart tabs section */}
        <ChartTabs 
          dailyData={stats.daily} 
          devices={stats.devices} 
          deviceData={stats.deviceData} 
          totals={stats.totals} 
        />

        {/* Recent activity table section */}
        <RecentActivity dailyData={stats.daily} />
      </div>
    </div>
  )
}
