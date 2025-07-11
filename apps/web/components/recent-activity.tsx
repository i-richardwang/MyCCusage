"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { DataTablePagination } from "@/components/data-table-pagination"
import { DailyRecord, TimeRange } from "@/types/chart-types"
import { filterByTimeRange } from "@/hooks/use-chart-data"

interface RecentActivityProps {
  dailyData: DailyRecord[]
  timeRange: TimeRange
  customDateRange?: { from: Date; to: Date }
}

export function RecentActivity({ dailyData, timeRange, customDateRange }: RecentActivityProps) {
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  
  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [timeRange, customDateRange, itemsPerPage])
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  const formatTokens = (tokens: number) => {
    const tokensInMillions = tokens / 1000000
    return `${tokensInMillions.toFixed(1)}M`
  }

  const formatTokensK = (tokens: number) => {
    const tokensInK = tokens / 1000
    return `${tokensInK.toFixed(2)}K`
  }

  // Apply time range filter
  const filteredData = filterByTimeRange(dailyData, timeRange, customDateRange)
  
  // Calculate pagination
  const totalItems = filteredData.length
  const totalPages = Math.ceil(totalItems / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedData = filteredData.slice(startIndex, endIndex)
  
  // Handle pagination changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }
  
  const handleItemsPerPageChange = (newItemsPerPage: number) => {
    setItemsPerPage(newItemsPerPage)
    setCurrentPage(1) // Reset to first page when changing items per page
  }

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
              {paginatedData.map((day) => (
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
        
        <DataTablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={handlePageChange}
          onItemsPerPageChange={handleItemsPerPageChange}
        />
      </CardContent>
    </Card>
  )
}