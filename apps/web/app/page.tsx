"use client"

import { MetricCard } from "@/components/metric-card"
import { useUsageStats } from "@/hooks/use-usage-stats"

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

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Claude Code Usage Monitor</h1>
        <p className="text-muted-foreground">Monitor your Claude API usage statistics</p>
      </div>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Total Cost"
          value={`$${stats?.totalCost.toFixed(4) || '0.0000'}`}
          description="Total API costs"
        />
        <MetricCard
          title="Total Tokens"
          value={stats?.totalTokens.toLocaleString() || '0'}
          description="Total tokens processed"
        />
        <MetricCard
          title="Total Records"
          value={stats?.recordCount.toLocaleString() || '0'}
          description="Number of usage records"
        />
      </div>
    </div>
  )
}
