import { useMemo } from 'react'
import { DailyRecord, DeviceRecord, Device, TimeRange, ChartRecord, MultiDeviceChartRecord, RatioChartData } from '@/types/chart-types'
import { CHART_COLORS, TIME_RANGE_DAYS, INPUT_OUTPUT_RATIO_CHART_CONFIG } from '@/constants/chart-config'

// Shared utility for time range filtering
export function filterByTimeRange<T extends { date: string }>(
  data: T[], 
  timeRange: TimeRange, 
  customDateRange?: { from: Date; to: Date }
): T[] {
  if (timeRange === "all") {
    return data
  }
  
  if (timeRange === "custom" && customDateRange) {
    return data.filter((item) => {
      const date = new Date(item.date)
      return date >= customDateRange.from && date <= customDateRange.to
    })
  }
  
  return data.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date()
    const daysToSubtract = TIME_RANGE_DAYS[timeRange]
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })
}

// Generate all dates in a range for chart continuity
function generateDateRange(timeRange: TimeRange, customDateRange?: { from: Date; to: Date }): string[] {
  if (timeRange === "all") {
    // For "all" range, return empty array - will be handled by existing data
    return []
  }
  
  let startDate: Date
  let endDate: Date
  
  if (timeRange === "custom" && customDateRange) {
    startDate = new Date(customDateRange.from)
    endDate = new Date(customDateRange.to)
  } else {
    const today = new Date()
    const daysToSubtract = TIME_RANGE_DAYS[timeRange]
    startDate = new Date(today)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    endDate = today
  }
  
  const dates: string[] = []
  const currentDate = new Date(startDate)
  
  while (currentDate <= endDate) {
    const dateString = currentDate.toISOString().split('T')[0]
    if (dateString) {
      dates.push(dateString)
    }
    currentDate.setDate(currentDate.getDate() + 1)
  }
  
  return dates
}

// Hook for single-device chart data
export function useSingleDeviceChartData(
  dailyData: DailyRecord[], 
  timeRange: TimeRange, 
  customDateRange?: { from: Date; to: Date }
) {
  return useMemo(() => {
    const chartData = dailyData.map(record => ({
      date: record.date,
      cost: record.totalCost,
      tokens: record.totalTokens / 1000000, // Convert to millions
      inputTokens: record.inputTokens / 1000000,
      outputTokens: record.outputTokens / 1000000,
      cacheTokens: (record.cacheCreationTokens + record.cacheReadTokens) / 1000000
    })).reverse() // Reverse array for chronological order

    return filterByTimeRange(chartData, timeRange, customDateRange)
  }, [dailyData, timeRange, customDateRange])
}

// Hook for multi-device chart data  
export function useMultiDeviceChartData(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date }
) {
  return useMemo(() => {
    // First filter device data by time range
    const filteredDeviceData = filterByTimeRange(deviceData, timeRange, customDateRange)
    
    // Get active device IDs from filtered data
    const activeDeviceIds = new Set(filteredDeviceData.map(record => record.deviceId))
    
    // Filter devices to only include those with data in the selected time range
    const activeDevices = devices.filter(device => activeDeviceIds.has(device.deviceId))
    
    // Group device data by date
    const dateGroups = filteredDeviceData.reduce((acc, record) => {
      if (!acc[record.date]) {
        acc[record.date] = {}
      }
      acc[record.date]![record.deviceId] = record.totalCost
      return acc
    }, {} as Record<string, Record<string, number>>)

    // Generate complete date range for continuity
    const allDates = timeRange === "all" 
      ? Array.from(new Set(filteredDeviceData.map(record => record.date))).sort()
      : generateDateRange(timeRange, customDateRange)

    // Create complete chart data with zero-fill for missing dates
    const chartData = allDates.map(date => {
      const dataPoint: Record<string, string | number> = { date }
      
      // Add data for each active device, defaulting to 0 if no data exists
      activeDevices.forEach(device => {
        dataPoint[device.deviceId] = dateGroups[date]?.[device.deviceId] || 0
      })
      
      return dataPoint
    })

    // Generate chart configuration only for active devices
    const chartConfig = activeDevices.reduce((config, device, index) => {
      const deviceName = device.deviceName || `Device ${index + 1}`
      config[device.deviceId] = {
        label: deviceName,
        color: CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]
      }
      return config
    }, {} as Record<string, { label: string; color: string }>)

    return {
      chartData,
      chartConfig,
      activeDevices // Return filtered devices for chart rendering
    }
  }, [deviceData, devices, timeRange, customDateRange])
}

// Hook for Input/Output ratio chart data
export function useInputOutputRatioChartData(
  dailyData: DailyRecord[], 
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date }
): RatioChartData {
  return useMemo(() => {
    // Calculate daily ratios and running average
    const ratioData = dailyData.map(record => {
      const ratio = record.outputTokens > 0 ? record.inputTokens / record.outputTokens : 0
      return {
        date: record.date,
        ratio: Number(ratio.toFixed(2)), // Round to 2 decimal places
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens
      }
    }).reverse() // Reverse for chronological order

    // Filter by time range first
    const filteredData = filterByTimeRange(ratioData, timeRange, customDateRange)

    // Calculate rolling average ratio for the filtered data
    const chartData = filteredData.map((record, index) => {
      // Calculate average ratio from the beginning of the filtered period up to current point
      const relevantRecords = filteredData.slice(0, index + 1)
      const totalInput = relevantRecords.reduce((sum, r) => sum + r.inputTokens, 0)
      const totalOutput = relevantRecords.reduce((sum, r) => sum + r.outputTokens, 0)
      const averageRatio = totalOutput > 0 ? Number((totalInput / totalOutput).toFixed(2)) : 0

      return {
        date: record.date,
        ratio: record.ratio,
        averageRatio
      }
    })

    return {
      chartData,
      chartConfig: INPUT_OUTPUT_RATIO_CHART_CONFIG
    }
  }, [dailyData, timeRange, customDateRange])
}

// Hook for multi-device token chart data
export function useMultiDeviceTokenData(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date }
) {
  return useMemo(() => {
    // First filter device data by time range
    const filteredDeviceData = filterByTimeRange(deviceData, timeRange, customDateRange)
    
    // Get active device IDs from filtered data
    const activeDeviceIds = new Set(filteredDeviceData.map(record => record.deviceId))
    
    // Filter devices to only include those with data in the selected time range
    const activeDevices = devices.filter(device => activeDeviceIds.has(device.deviceId))
    
    // Group device data by date for token usage
    const dateGroups = filteredDeviceData.reduce((acc, record) => {
      if (!acc[record.date]) {
        acc[record.date] = {}
      }
      acc[record.date]![record.deviceId] = record.totalTokens / 1000000 // Convert to millions
      return acc
    }, {} as Record<string, Record<string, number>>)

    // Generate complete date range for continuity
    const allDates = timeRange === "all" 
      ? Array.from(new Set(filteredDeviceData.map(record => record.date))).sort()
      : generateDateRange(timeRange, customDateRange)

    // Create complete chart data with zero-fill for missing dates
    const chartData = allDates.map(date => {
      const dataPoint: Record<string, string | number> = { date }
      
      // Add data for each active device, defaulting to 0 if no data exists
      activeDevices.forEach(device => {
        dataPoint[device.deviceId] = dateGroups[date]?.[device.deviceId] || 0
      })
      
      return dataPoint
    })

    // Generate chart configuration only for active devices
    const chartConfig = activeDevices.reduce((config, device, index) => {
      const deviceName = device.deviceName || `Device ${index + 1}`
      config[device.deviceId] = {
        label: deviceName,
        color: CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]
      }
      return config
    }, {} as Record<string, { label: string; color: string }>)

    return {
      chartData,
      chartConfig,
      activeDevices // Return filtered devices for chart rendering
    }
  }, [deviceData, devices, timeRange, customDateRange])
}