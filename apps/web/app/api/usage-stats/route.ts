import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords, devices } from '@/src/db/schema'
import { sql, desc, eq, SQL } from 'drizzle-orm'
import { getCurrentBillingCycle, getDaysRemainingInBillingCycle, getPreviousBillingCycle } from '@/lib/billing-cycle'

// Query factory for usage statistics aggregation
function createUsageStatsSelectFields() {
  return {
    totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
    totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
    totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
    totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
    totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
    totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
    activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`
  }
}

// Unified query function for usage statistics
async function getUsageStats(whereClause?: SQL) {
  const query = db
    .select(createUsageStatsSelectFields())
    .from(usageRecords)
    
  return whereClause ? query.where(whereClause) : query
}

// Safe type conversion utility
function safeNumber(value: unknown, defaultValue: number = 0): number {
  if (value === null || value === undefined) return defaultValue
  const num = typeof value === 'string' ? parseFloat(value) : Number(value)
  return isNaN(num) ? defaultValue : num
}

// Types for query results
interface RawStatsResult {
  totalCost: unknown
  totalTokens: unknown
  totalInputTokens: unknown
  totalOutputTokens: unknown
  totalCacheCreationTokens: unknown
  totalCacheReadTokens: unknown
  activeDays: unknown
}

interface TransformedStats {
  totalCost: number
  totalTokens: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheCreationTokens: number
  totalCacheReadTokens: number
  activeDays: number
}

// Validate and transform stats data
function validateAndTransformStats(rawStats: RawStatsResult[]): TransformedStats {
  if (!Array.isArray(rawStats) || rawStats.length === 0) {
    throw new Error('No stats data received from database')
  }
  
  const [stats] = rawStats
  if (!stats) {
    throw new Error('Empty stats record')
  }

  return {
    totalCost: safeNumber(stats.totalCost),
    totalTokens: safeNumber(stats.totalTokens),
    totalInputTokens: safeNumber(stats.totalInputTokens),
    totalOutputTokens: safeNumber(stats.totalOutputTokens),
    totalCacheCreationTokens: safeNumber(stats.totalCacheCreationTokens),
    totalCacheReadTokens: safeNumber(stats.totalCacheReadTokens),
    activeDays: safeNumber(stats.activeDays),
  }
}

export async function GET() {
  try {
    // Get billing cycle configuration
    const billingStartDate = process.env.CLAUDE_BILLING_CYCLE_START_DATE
    if (!billingStartDate) {
      return NextResponse.json({ error: 'CLAUDE_BILLING_CYCLE_START_DATE environment variable is required' }, { status: 500 })
    }
    const currentCycle = getCurrentBillingCycle(billingStartDate)
    const previousCycle = getPreviousBillingCycle(billingStartDate)
    
    // Format dates for SQL (YYYY-MM-DD)
    const formatDateForSQL = (date: Date) => date.toISOString().split('T')[0]
    const cycleStartDate = formatDateForSQL(currentCycle.startDate)
    const cycleEndDate = formatDateForSQL(currentCycle.endDate)
    const prevCycleStartDate = formatDateForSQL(previousCycle.startDate)
    const prevCycleEndDate = formatDateForSQL(previousCycle.endDate)

    // Get cumulative stats for ROI calculations
    const cumulativeStats = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`,
        earliestDate: sql<string>`MIN(${usageRecords.date})`,
        latestDate: sql<string>`MAX(${usageRecords.date})`
      })
      .from(usageRecords)

    // Execute all stats queries in parallel using the unified function
    const [totalStats, currentCycleStats, previousCycleStats] = await Promise.all([
      getUsageStats(),
      getUsageStats(sql`${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate}`),
      getUsageStats(sql`${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate}`)
    ])

    // Get daily records for charts and tables (last 30 days) - sum across all devices per day
    const dailyRecords = await db
      .select({
        date: usageRecords.date,
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        inputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
        outputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
        cacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
        cacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
        modelsUsed: sql<string[]>`ARRAY[]::text[]`, // Empty array - simplified
        createdAt: sql<Date>`MAX(${usageRecords.createdAt})`
      })
      .from(usageRecords)
      .groupBy(usageRecords.date)
      .orderBy(desc(usageRecords.date))
      .limit(30)

    // Get device-specific daily records for multi-device charts (last 30 days)
    const deviceDailyRecords = await db
      .select({
        date: usageRecords.date,
        deviceId: usageRecords.deviceId,
        totalCost: sql<number>`${usageRecords.totalCost}::numeric`,
        totalTokens: sql<number>`${usageRecords.totalTokens}::bigint`,
        inputTokens: sql<number>`${usageRecords.inputTokens}::bigint`,
        outputTokens: sql<number>`${usageRecords.outputTokens}::bigint`,
        cacheCreationTokens: sql<number>`${usageRecords.cacheCreationTokens}::bigint`,
        cacheReadTokens: sql<number>`${usageRecords.cacheReadTokens}::bigint`,
      })
      .from(usageRecords)
      .orderBy(desc(usageRecords.date))
      .limit(300) // Allow for more records to cover multiple devices

    // Get device information with usage statistics
    const deviceInfo = await db
      .select({
        deviceId: devices.deviceId,
        deviceName: devices.deviceName,
        displayName: devices.displayName,
        lastActiveDate: sql<string>`MAX(${usageRecords.date})`,
        totalRecords: sql<number>`COUNT(${usageRecords.id})`,
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        createdAt: devices.createdAt,
        updatedAt: devices.updatedAt
      })
      .from(devices)
      .leftJoin(usageRecords, eq(devices.deviceId, usageRecords.deviceId))
      .groupBy(devices.deviceId, devices.deviceName, devices.displayName, devices.createdAt, devices.updatedAt)

    // Process query results with safe type conversion
    const totals = validateAndTransformStats(totalStats)
    const currentCycleTotals = validateAndTransformStats(currentCycleStats)
    const previousCycleTotals = validateAndTransformStats(previousCycleStats)
    
    const dailyData = dailyRecords.map(record => ({
      date: record.date,
      totalCost: safeNumber(record.totalCost),
      totalTokens: safeNumber(record.totalTokens),
      inputTokens: safeNumber(record.inputTokens),
      outputTokens: safeNumber(record.outputTokens),
      cacheCreationTokens: safeNumber(record.cacheCreationTokens),
      cacheReadTokens: safeNumber(record.cacheReadTokens),
      modelsUsed: record.modelsUsed as string[],
      createdAt: record.createdAt
    }))

    // Process device-specific data for multi-device charts
    const deviceData = deviceDailyRecords.map(record => ({
      date: record.date,
      deviceId: record.deviceId,
      totalCost: safeNumber(record.totalCost),
      totalTokens: safeNumber(record.totalTokens),
      inputTokens: safeNumber(record.inputTokens),
      outputTokens: safeNumber(record.outputTokens),
      cacheCreationTokens: safeNumber(record.cacheCreationTokens),
      cacheReadTokens: safeNumber(record.cacheReadTokens),
    }))

    // Create device info map with accurate statistics
    const devicesData = deviceInfo.map((device, index) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName || `Device ${index + 1}`,
      displayName: device.displayName,
      recordCount: safeNumber(device.totalRecords),
      totalCost: safeNumber(device.totalCost),
      lastActiveDate: device.lastActiveDate,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    }))

    // Process cumulative stats for ROI calculations
    const cumulativeData = cumulativeStats[0]
    const processedCumulative = {
      totalCost: safeNumber(cumulativeData?.totalCost),
      totalTokens: safeNumber(cumulativeData?.totalTokens),
      activeDays: safeNumber(cumulativeData?.activeDays),
      earliestDate: cumulativeData?.earliestDate || null,
      latestDate: cumulativeData?.latestDate || null
    }

    // Calculate derived metrics
    const activeDays = totals.activeDays
    const avgDailyCost = activeDays > 0 ? totals.totalCost / activeDays : 0

    return NextResponse.json({
      billingCycle: {
        startDate: currentCycle.startDate.toISOString(),
        endDate: currentCycle.endDate.toISOString(),
        label: currentCycle.cycleLabel,
        startDateConfig: billingStartDate,
        daysRemaining: getDaysRemainingInBillingCycle(billingStartDate)
      },
      totals: {
        totalCost: totals.totalCost,
        totalTokens: totals.totalTokens,
        totalInputTokens: totals.totalInputTokens,
        totalOutputTokens: totals.totalOutputTokens,
        totalCacheCreationTokens: totals.totalCacheCreationTokens,
        totalCacheReadTokens: totals.totalCacheReadTokens,
        activeDays: totals.activeDays,
        avgDailyCost
      },
      currentCycle: {
        totalCost: currentCycleTotals.totalCost,
        totalTokens: currentCycleTotals.totalTokens,
        totalInputTokens: currentCycleTotals.totalInputTokens,
        totalOutputTokens: currentCycleTotals.totalOutputTokens,
        totalCacheCreationTokens: currentCycleTotals.totalCacheCreationTokens,
        totalCacheReadTokens: currentCycleTotals.totalCacheReadTokens,
        activeDays: currentCycleTotals.activeDays,
        avgDailyCost: currentCycleTotals.activeDays > 0 ? currentCycleTotals.totalCost / currentCycleTotals.activeDays : 0
      },
      previousCycle: {
        totalCost: previousCycleTotals.totalCost,
        totalTokens: previousCycleTotals.totalTokens,
        totalInputTokens: previousCycleTotals.totalInputTokens,
        totalOutputTokens: previousCycleTotals.totalOutputTokens,
        totalCacheCreationTokens: previousCycleTotals.totalCacheCreationTokens,
        totalCacheReadTokens: previousCycleTotals.totalCacheReadTokens,
        activeDays: previousCycleTotals.activeDays,
        avgDailyCost: previousCycleTotals.activeDays > 0 ? previousCycleTotals.totalCost / previousCycleTotals.activeDays : 0
      },
      daily: dailyData,
      devices: devicesData,
      deviceData: deviceData,
      cumulative: processedCumulative
    })
  } catch (error) {
    console.error('Error fetching usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics' },
      { status: 500 }
    )
  }
}