import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords, devices } from '@/src/db/schema'
import { sql, desc, eq } from 'drizzle-orm'
import { getCurrentBillingCycle, getDaysRemainingInBillingCycle, getPreviousBillingCycle } from '@/lib/billing-cycle'
import { QUERY_LIMITS } from '@/constants/business-config'
import type { AgentType } from '@/types/chart-types'

// Optimized unified statistics query using CTE
async function getUnifiedUsageStats(
  cycleStartDate: string,
  cycleEndDate: string,
  prevCycleStartDate: string,
  prevCycleEndDate: string
) {
  // Define CTE for aggregated usage statistics across different time periods
  const statsQuery = db.$with('usage_stats').as(
    db.select({
      totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`.as('total_cost'),
      totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`.as('total_tokens'),
      totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`.as('total_input_tokens'),
      totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`.as('total_output_tokens'),
      totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`.as('total_cache_creation_tokens'),
      totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`.as('total_cache_read_tokens'),
      totalCredits: sql<number>`SUM(${usageRecords.credits})::numeric`.as('total_credits'),
      activeDays: sql<number>`COUNT(DISTINCT ${usageRecords.date})::bigint`.as('active_days'),

      // Current cycle stats
      currentCycleCost: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.totalCost} ELSE 0 END)::numeric`.as('current_cycle_cost'),
      currentCycleTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.totalTokens} ELSE 0 END)::bigint`.as('current_cycle_tokens'),
      currentCycleInputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.inputTokens} ELSE 0 END)::bigint`.as('current_cycle_input_tokens'),
      currentCycleOutputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.outputTokens} ELSE 0 END)::bigint`.as('current_cycle_output_tokens'),
      currentCycleCacheCreationTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.cacheCreationTokens} ELSE 0 END)::bigint`.as('current_cycle_cache_creation_tokens'),
      currentCycleCacheReadTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.cacheReadTokens} ELSE 0 END)::bigint`.as('current_cycle_cache_read_tokens'),
      currentCycleCredits: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.credits} ELSE 0 END)::numeric`.as('current_cycle_credits'),
      currentCycleActiveDays: sql<number>`COUNT(DISTINCT CASE WHEN ${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate} THEN ${usageRecords.date} END)::bigint`.as('current_cycle_active_days'),

      // Previous cycle stats
      previousCycleCost: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.totalCost} ELSE 0 END)::numeric`.as('previous_cycle_cost'),
      previousCycleTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.totalTokens} ELSE 0 END)::bigint`.as('previous_cycle_tokens'),
      previousCycleInputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.inputTokens} ELSE 0 END)::bigint`.as('previous_cycle_input_tokens'),
      previousCycleOutputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.outputTokens} ELSE 0 END)::bigint`.as('previous_cycle_output_tokens'),
      previousCycleCacheCreationTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.cacheCreationTokens} ELSE 0 END)::bigint`.as('previous_cycle_cache_creation_tokens'),
      previousCycleCacheReadTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.cacheReadTokens} ELSE 0 END)::bigint`.as('previous_cycle_cache_read_tokens'),
      previousCycleCredits: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.credits} ELSE 0 END)::numeric`.as('previous_cycle_credits'),
      previousCycleActiveDays: sql<number>`COUNT(DISTINCT CASE WHEN ${usageRecords.date} >= ${prevCycleStartDate} AND ${usageRecords.date} <= ${prevCycleEndDate} THEN ${usageRecords.date} END)::bigint`.as('previous_cycle_active_days'),

      // Last 30 days stats (for consistent data across all components)
      last30DaysCost: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.totalCost} ELSE 0 END)::numeric`.as('last_30_days_cost'),
      last30DaysTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.totalTokens} ELSE 0 END)::bigint`.as('last_30_days_tokens'),
      last30DaysInputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.inputTokens} ELSE 0 END)::bigint`.as('last_30_days_input_tokens'),
      last30DaysOutputTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.outputTokens} ELSE 0 END)::bigint`.as('last_30_days_output_tokens'),
      last30DaysCacheCreationTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.cacheCreationTokens} ELSE 0 END)::bigint`.as('last_30_days_cache_creation_tokens'),
      last30DaysCacheReadTokens: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.cacheReadTokens} ELSE 0 END)::bigint`.as('last_30_days_cache_read_tokens'),
      last30DaysCredits: sql<number>`SUM(CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.credits} ELSE 0 END)::numeric`.as('last_30_days_credits'),
      last30DaysActiveDays: sql<number>`COUNT(DISTINCT CASE WHEN ${usageRecords.date} >= CURRENT_DATE - INTERVAL '30 days' THEN ${usageRecords.date} END)::bigint`.as('last_30_days_active_days'),

      // Cumulative metadata
      earliestDate: sql<string>`MIN(${usageRecords.date})`.as('earliest_date'),
      latestDate: sql<string>`MAX(${usageRecords.date})`.as('latest_date')
    })
    .from(usageRecords)
  )

  // Execute the unified CTE query
  return await db.with(statsQuery).select().from(statsQuery)
}

// Safe type conversion utility
function safeNumber(value: unknown, defaultValue: number = 0): number {
  if (value === null || value === undefined) return defaultValue
  const num = typeof value === 'string' ? parseFloat(value) : Number(value)
  return isNaN(num) ? defaultValue : num
}

// Optimized daily and device data queries using parallel execution
async function getDailyAndDeviceData() {
  return await Promise.all([
    // Daily records query (last 30 days, aggregated by date)
    db.select({
      date: usageRecords.date,
      totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`.as('total_cost'),
      totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`.as('total_tokens'),
      inputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`.as('input_tokens'),
      outputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`.as('output_tokens'),
      cacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`.as('cache_creation_tokens'),
      cacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`.as('cache_read_tokens'),
      credits: sql<number>`SUM(${usageRecords.credits})::numeric`.as('credits'),
      modelsUsed: sql<string[]>`ARRAY[]::text[]`.as('models_used'),
      createdAt: sql<Date>`MAX(${usageRecords.createdAt})`.as('created_at')
    })
    .from(usageRecords)
    .groupBy(usageRecords.date)
    .orderBy(desc(usageRecords.date))
    .limit(QUERY_LIMITS.DAILY_RECORDS),

    // Device-specific daily records for multi-device charts
    db.select({
      date: usageRecords.date,
      deviceId: usageRecords.deviceId,
      agentType: usageRecords.agentType,
      totalCost: sql<number>`${usageRecords.totalCost}::numeric`.as('total_cost'),
      totalTokens: sql<number>`${usageRecords.totalTokens}::bigint`.as('total_tokens'),
      inputTokens: sql<number>`${usageRecords.inputTokens}::bigint`.as('input_tokens'),
      outputTokens: sql<number>`${usageRecords.outputTokens}::bigint`.as('output_tokens'),
      cacheCreationTokens: sql<number>`${usageRecords.cacheCreationTokens}::bigint`.as('cache_creation_tokens'),
      cacheReadTokens: sql<number>`${usageRecords.cacheReadTokens}::bigint`.as('cache_read_tokens'),
      credits: sql<number>`${usageRecords.credits}::numeric`.as('credits'),
    })
    .from(usageRecords)
    .orderBy(desc(usageRecords.date))
    .limit(QUERY_LIMITS.DEVICE_RECORDS),

    // Device information with aggregated usage statistics
    db.select({
      deviceId: devices.deviceId,
      deviceName: devices.deviceName,
      displayName: devices.displayName,
      lastActiveDate: sql<string>`MAX(${usageRecords.date})`.as('last_active_date'),
      totalRecords: sql<number>`COUNT(${usageRecords.id})`.as('total_records'),
      totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`.as('total_cost'),
      agentTypes: sql<string[]>`ARRAY_AGG(DISTINCT ${usageRecords.agentType})`.as('agent_types'),
      createdAt: devices.createdAt,
      updatedAt: devices.updatedAt
    })
    .from(devices)
    .leftJoin(usageRecords, eq(devices.deviceId, usageRecords.deviceId))
    .groupBy(devices.deviceId, devices.deviceName, devices.displayName, devices.createdAt, devices.updatedAt),

    // Agent-specific daily records for multi-agent charts
    db.select({
      date: usageRecords.date,
      agentType: usageRecords.agentType,
      totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`.as('total_cost'),
      totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`.as('total_tokens'),
      inputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`.as('input_tokens'),
      outputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`.as('output_tokens'),
      cacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`.as('cache_creation_tokens'),
      cacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`.as('cache_read_tokens'),
      credits: sql<number>`SUM(${usageRecords.credits})::numeric`.as('credits'),
    })
    .from(usageRecords)
    .groupBy(usageRecords.date, usageRecords.agentType)
    .orderBy(desc(usageRecords.date))
    .limit(QUERY_LIMITS.DAILY_RECORDS * 3), // Account for multiple agents

    // Available agents (distinct agent types in the database)
    db.selectDistinct({
      agentType: usageRecords.agentType
    }).from(usageRecords)
  ])
}

export async function GET() {
  try {
    // Get billing cycle configuration
    const billingStartDate = process.env.CLAUDE_BILLING_CYCLE_START_DATE
    if (!billingStartDate) {
      return NextResponse.json({ error: 'CLAUDE_BILLING_CYCLE_START_DATE environment variable is required' }, { status: 500 })
    }
    const currentCycleInfo = getCurrentBillingCycle(billingStartDate)
    const previousCycleInfo = getPreviousBillingCycle(billingStartDate)
    
    // Format dates for SQL (YYYY-MM-DD)
    const formatDateForSQL = (date: Date) => date.toISOString().substring(0, 10)
    const cycleStartDate = formatDateForSQL(currentCycleInfo.startDate)
    const cycleEndDate = formatDateForSQL(currentCycleInfo.endDate)
    const prevCycleStartDate = formatDateForSQL(previousCycleInfo.startDate)
    const prevCycleEndDate = formatDateForSQL(previousCycleInfo.endDate)

    // Execute optimized parallel queries
    const [unifiedStats, [dailyRecords, deviceDailyRecords, deviceInfo, agentDailyRecords, availableAgentsResult]] = await Promise.all([
      getUnifiedUsageStats(cycleStartDate, cycleEndDate, prevCycleStartDate, prevCycleEndDate),
      getDailyAndDeviceData()
    ])

    // Extract unified statistics from CTE result
    const statsResult = unifiedStats[0]
    if (!statsResult) {
      throw new Error('No statistics data returned from database')
    }

    // Transform daily data with safe type conversion
    const dailyData = dailyRecords.map(record => ({
      date: record.date,
      totalCost: safeNumber(record.totalCost),
      totalTokens: safeNumber(record.totalTokens),
      inputTokens: safeNumber(record.inputTokens),
      outputTokens: safeNumber(record.outputTokens),
      cacheCreationTokens: safeNumber(record.cacheCreationTokens),
      cacheReadTokens: safeNumber(record.cacheReadTokens),
      credits: safeNumber(record.credits),
      modelsUsed: record.modelsUsed as string[],
      createdAt: record.createdAt
    }))

    // Transform device-specific data for multi-device charts
    const deviceData = deviceDailyRecords.map(record => ({
      date: record.date,
      deviceId: record.deviceId,
      agentType: record.agentType as AgentType,
      totalCost: safeNumber(record.totalCost),
      totalTokens: safeNumber(record.totalTokens),
      inputTokens: safeNumber(record.inputTokens),
      outputTokens: safeNumber(record.outputTokens),
      cacheCreationTokens: safeNumber(record.cacheCreationTokens),
      cacheReadTokens: safeNumber(record.cacheReadTokens),
      credits: safeNumber(record.credits),
    }))

    // Transform device information with statistics
    const devicesData = deviceInfo.map((device, index) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName || `Device ${index + 1}`,
      displayName: device.displayName,
      recordCount: safeNumber(device.totalRecords),
      totalCost: safeNumber(device.totalCost),
      lastActiveDate: device.lastActiveDate,
      agentTypes: (device.agentTypes || []).filter(Boolean) as AgentType[],
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    }))

    // Transform agent-specific data for multi-agent charts
    const agentData = agentDailyRecords.map(record => ({
      date: record.date,
      agentType: record.agentType as AgentType,
      totalCost: safeNumber(record.totalCost),
      totalTokens: safeNumber(record.totalTokens),
      inputTokens: safeNumber(record.inputTokens),
      outputTokens: safeNumber(record.outputTokens),
      cacheCreationTokens: safeNumber(record.cacheCreationTokens),
      cacheReadTokens: safeNumber(record.cacheReadTokens),
      credits: safeNumber(record.credits),
    }))

    // Get available agents list
    const availableAgents = availableAgentsResult
      .map(r => r.agentType as AgentType)
      .filter(Boolean)

    // Extract and transform statistics from unified CTE result
    const totals = {
      totalCost: safeNumber(statsResult.totalCost),
      totalTokens: safeNumber(statsResult.totalTokens),
      totalInputTokens: safeNumber(statsResult.totalInputTokens),
      totalOutputTokens: safeNumber(statsResult.totalOutputTokens),
      totalCacheCreationTokens: safeNumber(statsResult.totalCacheCreationTokens),
      totalCacheReadTokens: safeNumber(statsResult.totalCacheReadTokens),
      totalCredits: safeNumber(statsResult.totalCredits),
      activeDays: safeNumber(statsResult.activeDays),
      avgDailyCost: safeNumber(statsResult.activeDays) > 0 ? safeNumber(statsResult.totalCost) / safeNumber(statsResult.activeDays) : 0
    }

    const currentCycle = {
      totalCost: safeNumber(statsResult.currentCycleCost),
      totalTokens: safeNumber(statsResult.currentCycleTokens),
      totalInputTokens: safeNumber(statsResult.currentCycleInputTokens),
      totalOutputTokens: safeNumber(statsResult.currentCycleOutputTokens),
      totalCacheCreationTokens: safeNumber(statsResult.currentCycleCacheCreationTokens),
      totalCacheReadTokens: safeNumber(statsResult.currentCycleCacheReadTokens),
      totalCredits: safeNumber(statsResult.currentCycleCredits),
      activeDays: safeNumber(statsResult.currentCycleActiveDays),
      avgDailyCost: safeNumber(statsResult.currentCycleActiveDays) > 0 ? safeNumber(statsResult.currentCycleCost) / safeNumber(statsResult.currentCycleActiveDays) : 0
    }

    const previousCycle = {
      totalCost: safeNumber(statsResult.previousCycleCost),
      totalTokens: safeNumber(statsResult.previousCycleTokens),
      totalInputTokens: safeNumber(statsResult.previousCycleInputTokens),
      totalOutputTokens: safeNumber(statsResult.previousCycleOutputTokens),
      totalCacheCreationTokens: safeNumber(statsResult.previousCycleCacheCreationTokens),
      totalCacheReadTokens: safeNumber(statsResult.previousCycleCacheReadTokens),
      totalCredits: safeNumber(statsResult.previousCycleCredits),
      activeDays: safeNumber(statsResult.previousCycleActiveDays),
      avgDailyCost: safeNumber(statsResult.previousCycleActiveDays) > 0 ? safeNumber(statsResult.previousCycleCost) / safeNumber(statsResult.previousCycleActiveDays) : 0
    }

    const last30Days = {
      totalCost: safeNumber(statsResult.last30DaysCost),
      totalTokens: safeNumber(statsResult.last30DaysTokens),
      totalInputTokens: safeNumber(statsResult.last30DaysInputTokens),
      totalOutputTokens: safeNumber(statsResult.last30DaysOutputTokens),
      totalCacheCreationTokens: safeNumber(statsResult.last30DaysCacheCreationTokens),
      totalCacheReadTokens: safeNumber(statsResult.last30DaysCacheReadTokens),
      totalCredits: safeNumber(statsResult.last30DaysCredits),
      activeDays: safeNumber(statsResult.last30DaysActiveDays),
      avgDailyCost: safeNumber(statsResult.last30DaysActiveDays) > 0 ? safeNumber(statsResult.last30DaysCost) / safeNumber(statsResult.last30DaysActiveDays) : 0
    }

    // Cumulative data for ROI calculations
    const processedCumulative = {
      totalCost: safeNumber(statsResult.totalCost),
      totalTokens: safeNumber(statsResult.totalTokens),
      activeDays: safeNumber(statsResult.activeDays),
      earliestDate: statsResult.earliestDate || null,
      latestDate: statsResult.latestDate || null
    }

    return NextResponse.json({
      billingCycle: {
        startDate: currentCycleInfo.startDate.toISOString(),
        endDate: currentCycleInfo.endDate.toISOString(),
        label: currentCycleInfo.cycleLabel,
        startDateConfig: billingStartDate,
        daysRemaining: getDaysRemainingInBillingCycle(billingStartDate)
      },
      totals,
      currentCycle,
      previousCycle,
      last30Days,
      daily: dailyData,
      devices: devicesData,
      deviceData: deviceData,
      agentData: agentData,
      availableAgents: availableAgents,
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