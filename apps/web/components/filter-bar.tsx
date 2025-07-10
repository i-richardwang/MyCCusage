"use client"

import { TimeRange } from "@/types/chart-types"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"

interface FilterBarProps {
  timeRange: TimeRange
  onTimeRangeChange: (timeRange: TimeRange) => void
}

export function FilterBar({ timeRange, onTimeRangeChange }: FilterBarProps) {
  return (
    <div className="flex items-center justify-between py-4 border-b">
      <div className="flex items-center space-x-2">
        <span className="text-sm font-medium text-muted-foreground">Time Range:</span>
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
          </SelectContent>
        </Select>
      </div>
      <div className="text-sm text-muted-foreground">
        {/* Future: Add other filters like device selection */}
      </div>
    </div>
  )
}