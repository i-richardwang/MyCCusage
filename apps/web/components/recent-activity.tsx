"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

interface DailyRecord {
  date: string
  totalCost: number
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

interface RecentActivityProps {
  dailyData: DailyRecord[]
}

export function RecentActivity({ dailyData }: RecentActivityProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(4)}`
  }

  const formatTokens = (tokens: number) => {
    const tokensInMillions = tokens / 1000000
    return `${tokensInMillions.toFixed(1)}M`
  }

  const formatTokensK = (tokens: number) => {
    const tokensInK = tokens / 1000
    return `${tokensInK.toLocaleString()}K`
  }

  // Show only the most recent 8 records
  const recentData = dailyData.slice(0, 8)

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>
            Latest usage data and metrics
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Date</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Cost</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Tokens</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Input</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Output</th>
                <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Cache</th>
              </tr>
            </thead>
            <tbody>
              {recentData.map((day) => (
                <tr key={day.date} className="border-b">
                  <td className="py-3 px-2 text-sm font-medium">
                    {new Date(day.date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </td>
                  <td className="py-3 px-2 text-sm font-bold">
                    {formatCurrency(day.totalCost)}
                  </td>
                  <td className="py-3 px-2 text-sm font-medium">
                    {formatTokens(day.totalTokens)}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatTokensK(day.inputTokens)}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatTokensK(day.outputTokens)}
                  </td>
                  <td className="py-3 px-2 text-sm text-muted-foreground">
                    {formatTokensK(day.cacheCreationTokens + day.cacheReadTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}