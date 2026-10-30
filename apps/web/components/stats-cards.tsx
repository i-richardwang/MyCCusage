"use client"

import { Card, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Cpu, Send, Activity, Database } from "lucide-react"
import type { UsageSummary } from "@/lib/usage-view"

interface StatsCardsProps {
  summary: UsageSummary
}

export function StatsCards({ summary }: StatsCardsProps) {
  const formatTokens = (tokens: number) => `${(tokens / 1000000).toFixed(1)}M`

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Total Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(summary.totalTokens)}</CardTitle>
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
              <CardTitle className="text-3xl">{formatTokens(summary.cacheReadTokens)}</CardTitle>
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
              <CardDescription>Output Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(summary.outputTokens)}</CardTitle>
              <CardDescription>Total output generated</CardDescription>
            </div>
            <Send className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex items-center h-full">
          <div className="flex items-center justify-between w-full">
            <div className="space-y-1">
              <CardDescription>Average Daily Tokens</CardDescription>
              <CardTitle className="text-3xl">{formatTokens(summary.avgDailyTokens)}</CardTitle>
              <CardDescription>Daily token processing rate</CardDescription>
            </div>
            <Activity className="h-6 w-6 text-muted-foreground" />
          </div>
        </CardHeader>
      </Card>
    </div>
  )
}
