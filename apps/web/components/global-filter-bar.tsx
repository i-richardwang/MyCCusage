"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { type DateRange } from "react-day-picker"
import { TimeRange, ViewMode, BillingCycleRange, AgentType, AGENT_TYPE_LABELS } from "@/types/chart-types"
import { cn } from "@workspace/ui/lib/utils"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Button } from "@workspace/ui/components/button"
import { Calendar } from "@workspace/ui/components/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover"

interface GlobalFilterBarProps {
  viewMode: ViewMode
  onViewModeChange: (viewMode: ViewMode) => void
  timeRange: TimeRange
  onTimeRangeChange: (timeRange: TimeRange) => void
  billingCycleRange: BillingCycleRange
  onBillingCycleRangeChange: (range: BillingCycleRange) => void
  dateRange: DateRange | undefined
  onDateRangeChange: (dateRange: DateRange | undefined) => void
  agentFilter: AgentType | 'all'
  onAgentFilterChange: (agent: AgentType | 'all') => void
  availableAgents: AgentType[]
}

export function GlobalFilterBar({
  viewMode,
  onViewModeChange,
  timeRange,
  onTimeRangeChange,
  billingCycleRange,
  onBillingCycleRangeChange,
  dateRange,
  onDateRangeChange,
  agentFilter,
  onAgentFilterChange,
  availableAgents
}: GlobalFilterBarProps) {
  const isRollingMode = viewMode === "rolling"
  const isBillingMode = viewMode === "billing"

  const formatDateRange = (range: DateRange | undefined) => {
    if (range?.from) {
      if (range.to) {
        return `${format(range.from, "LLL dd, y")} - ${format(range.to, "LLL dd, y")}`
      } else {
        return format(range.from, "LLL dd, y")
      }
    }
    return "Pick a date range"
  }

  return (
    <div className="flex flex-col gap-4 py-4 border-b">
      {/* Agent Filter Tabs */}
      <div className="flex items-center gap-4">
        <Tabs value={agentFilter} onValueChange={(value) => onAgentFilterChange(value as AgentType | 'all')}>
          <TabsList>
            <TabsTrigger value="all">All Agents</TabsTrigger>
            {availableAgents.map(agent => (
              <TabsTrigger key={agent} value={agent}>
                {AGENT_TYPE_LABELS[agent]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* View Mode and Time Range Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={viewMode} onValueChange={(value) => onViewModeChange(value as ViewMode)}>
          <TabsList>
            <TabsTrigger value="rolling">Rolling View</TabsTrigger>
            <TabsTrigger value="billing">Billing Cycle</TabsTrigger>
          </TabsList>
        </Tabs>

      <div className="flex items-center gap-4 flex-wrap">
        {isRollingMode && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[280px] justify-start text-left font-normal rounded-lg",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formatDateRange(dateRange)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={onDateRangeChange}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>

            <Select value={timeRange} onValueChange={(value) => onTimeRangeChange(value as TimeRange)}>
              <SelectTrigger className="w-[160px] rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="rounded-lg">
                  All Time
                </SelectItem>
                <SelectItem value="30d" className="rounded-lg">
                  Last 30 days
                </SelectItem>
                <SelectItem value="14d" className="rounded-lg">
                  Last 14 days
                </SelectItem>
                <SelectItem value="7d" className="rounded-lg">
                  Last 7 days
                </SelectItem>
                <SelectItem value="custom" className="rounded-lg" disabled>
                  Custom
                </SelectItem>
              </SelectContent>
            </Select>
          </>
        )}

        {isBillingMode && (
          <Select
            value={billingCycleRange}
            onValueChange={(value) => onBillingCycleRangeChange(value as BillingCycleRange)}
          >
            <SelectTrigger className="w-[160px] rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="current" className="rounded-lg">
                Current Cycle
              </SelectItem>
              <SelectItem value="previous" className="rounded-lg">
                Previous Cycle
              </SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      </div>
    </div>
  )
}
