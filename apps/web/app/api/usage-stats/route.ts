import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords, devices } from '@/src/db/schema'
import { sql, desc, eq } from 'drizzle-orm'
import { getCurrentBillingCycle, getDaysRemainingInBillingCycle, getPreviousBillingCycle } from '@/lib/billing-cycle'

export async function GET() {
  try {
    // Get billing cycle configuration
    const billingStartDay = parseInt(process.env.CLAUDE_BILLING_CYCLE_START_DAY || '1')
    const currentCycle = getCurrentBillingCycle(billingStartDay)
    const previousCycle = getPreviousBillingCycle(billingStartDay)
    
    // Format dates for SQL (YYYY-MM-DD)
    const formatDateForSQL = (date: Date) => date.toISOString().split('T')[0]
    const cycleStartDate = formatDateForSQL(currentCycle.startDate)
    const cycleEndDate = formatDateForSQL(currentCycle.endDate)
    const prevCycleStartDate = formatDateForSQL(previousCycle.startDate)
    const prevCycleEndDate = formatDateForSQL(previousCycle.endDate)

    // Get aggregate totals (all time)
    const totalStats = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
        totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
        totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
        totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
        activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`
      })
      .from(usageRecords)

    // Get current billing cycle totals
    const currentCycleStats = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
        totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
        totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
        totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
        activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`
      })
      .from(usageRecords)
      .where(sql`${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate}`)

    // Get previous billing cycle totals
    const previousCycleStats = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
        totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
        totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
        totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
        activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`
      })
      .from(usageRecords)
      .where(sql`${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate}`)

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
        lastActiveDate: sql<string>`MAX(${usageRecords.date})`,
        totalRecords: sql<number>`COUNT(${usageRecords.id})`,
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        createdAt: devices.createdAt,
        updatedAt: devices.updatedAt
      })
      .from(devices)
      .leftJoin(usageRecords, eq(devices.deviceId, usageRecords.deviceId))
      .groupBy(devices.deviceId, devices.deviceName, devices.createdAt, devices.updatedAt)

    // Process query results 
    const [totals] = totalStats
    const [currentCycleTotals] = currentCycleStats
    const [previousCycleTotals] = previousCycleStats
    
    const dailyData = dailyRecords.map(record => ({
      date: record.date,
      totalCost: Number(record.totalCost),
      totalTokens: Number(record.totalTokens),
      inputTokens: Number(record.inputTokens),
      outputTokens: Number(record.outputTokens),
      cacheCreationTokens: Number(record.cacheCreationTokens),
      cacheReadTokens: Number(record.cacheReadTokens),
      modelsUsed: record.modelsUsed as string[],
      createdAt: record.createdAt
    }))

    // Process device-specific data for multi-device charts
    const deviceData = deviceDailyRecords.map(record => ({
      date: record.date,
      deviceId: record.deviceId,
      totalCost: Number(record.totalCost),
      totalTokens: Number(record.totalTokens),
      inputTokens: Number(record.inputTokens),
      outputTokens: Number(record.outputTokens),
      cacheCreationTokens: Number(record.cacheCreationTokens),
      cacheReadTokens: Number(record.cacheReadTokens),
    }))

    // Create device info map with accurate statistics
    const devicesData = deviceInfo.map((device, index) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName || `Device ${index + 1}`,
      recordCount: Number(device.totalRecords || 0),
      totalCost: Number(device.totalCost || 0),
      lastActiveDate: device.lastActiveDate,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    }))

    // Calculate derived metrics
    const activeDays = Number(totals?.activeDays || 0)
    const avgDailyCost = activeDays > 0 ? Number(totals?.totalCost || 0) / activeDays : 0

    return NextResponse.json({
      billingCycle: {
        startDate: currentCycle.startDate.toISOString(),
        endDate: currentCycle.endDate.toISOString(),
        label: currentCycle.cycleLabel,
        startDay: billingStartDay,
        daysRemaining: getDaysRemainingInBillingCycle(billingStartDay)
      },
      totals: {
        totalCost: Number(totals?.totalCost || 0),
        totalTokens: Number(totals?.totalTokens || 0),
        totalInputTokens: Number(totals?.totalInputTokens || 0),
        totalOutputTokens: Number(totals?.totalOutputTokens || 0),
        totalCacheCreationTokens: Number(totals?.totalCacheCreationTokens || 0),
        totalCacheReadTokens: Number(totals?.totalCacheReadTokens || 0),
        activeDays: activeDays,
        avgDailyCost
      },
      currentCycle: {
        totalCost: Number(currentCycleTotals?.totalCost || 0),
        totalTokens: Number(currentCycleTotals?.totalTokens || 0),
        totalInputTokens: Number(currentCycleTotals?.totalInputTokens || 0),
        totalOutputTokens: Number(currentCycleTotals?.totalOutputTokens || 0),
        totalCacheCreationTokens: Number(currentCycleTotals?.totalCacheCreationTokens || 0),
        totalCacheReadTokens: Number(currentCycleTotals?.totalCacheReadTokens || 0),
        activeDays: Number(currentCycleTotals?.activeDays || 0),
        avgDailyCost: Number(currentCycleTotals?.activeDays || 0) > 0 ? Number(currentCycleTotals?.totalCost || 0) / Number(currentCycleTotals?.activeDays || 0) : 0
      },
      previousCycle: {
        totalCost: Number(previousCycleTotals?.totalCost || 0),
        totalTokens: Number(previousCycleTotals?.totalTokens || 0),
        totalInputTokens: Number(previousCycleTotals?.totalInputTokens || 0),
        totalOutputTokens: Number(previousCycleTotals?.totalOutputTokens || 0),
        totalCacheCreationTokens: Number(previousCycleTotals?.totalCacheCreationTokens || 0),
        totalCacheReadTokens: Number(previousCycleTotals?.totalCacheReadTokens || 0),
        activeDays: Number(previousCycleTotals?.activeDays || 0),
        avgDailyCost: Number(previousCycleTotals?.activeDays || 0) > 0 ? Number(previousCycleTotals?.totalCost || 0) / Number(previousCycleTotals?.activeDays || 0) : 0
      },
      daily: dailyData,
      devices: devicesData,
      deviceData: deviceData
    })
  } catch (error) {
    console.error('Error fetching usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics' },
      { status: 500 }
    )
  }
}