import { useMemo } from 'react'
import { DailyRecord, DeviceRecord, Device, TimeRange, ChartRecord, MultiDeviceChartRecord } from '@/types/chart-types'
import { CHART_COLORS, TIME_RANGE_DAYS, TOKEN_BREAKDOWN_CHART_CONFIG } from '@/constants/chart-config'

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

    // Convert to chart format
    const chartData = Object.entries(dateGroups)
      .map(([date, deviceCosts]) => ({
        date,
        ...deviceCosts
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

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

// Hook for token breakdown chart data
export function useTokenBreakdownChartData(
  dailyData: DailyRecord[], 
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date }
) {
  return useMemo(() => {
    const chartData = dailyData.map(record => ({
      date: record.date,
      inputTokens: record.inputTokens / 1000000, // Convert to millions
      outputTokens: record.outputTokens / 1000000,
      cacheTokens: (record.cacheCreationTokens + record.cacheReadTokens) / 1000000
    })).reverse() // Reverse array for chronological order

    // Filter by time range
    const filteredChartData = filterByTimeRange(chartData, timeRange, customDateRange)

    return {
      chartData: filteredChartData,
      chartConfig: TOKEN_BREAKDOWN_CHART_CONFIG
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

    // Convert to chart format
    const chartData = Object.entries(dateGroups)
      .map(([date, deviceTokens]) => ({
        date,
        ...deviceTokens
      }))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

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