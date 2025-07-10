"use client"

import { Card, CardContent } from "@workspace/ui/components/card"
import { DollarSign, Cpu, TrendingUp, Calendar } from "lucide-react"

interface StatsCardsProps {
  totalCost: number
  totalTokens: number
  avgDailyCost: number
  activeDays: number
}

export function StatsCards({ totalCost, totalTokens, avgDailyCost, activeDays }: StatsCardsProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(4)}`
  }

  const formatTokens = (tokens: number) => {
    const tokensInMillions = tokens / 1000000
    return `${tokensInMillions.toFixed(1)}M`
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Cost */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Total Cost</p>
              <p className="text-2xl font-bold">{formatCurrency(totalCost)}</p>
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
              <p className="text-2xl font-bold">{formatTokens(totalTokens)}</p>
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
              <p className="text-2xl font-bold">{formatCurrency(avgDailyCost)}</p>
              <p className="text-xs text-muted-foreground">
                Daily average analysis
              </p>
            </div>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>

      {/* Active Days */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Active Days</p>
              <p className="text-2xl font-bold">{activeDays}</p>
              <p className="text-xs text-muted-foreground">
                Tracking period
              </p>
            </div>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}