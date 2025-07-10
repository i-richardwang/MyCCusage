import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords } from '@/src/db/schema'
import { sql, desc } from 'drizzle-orm'
import { getCurrentBillingCycle, getDaysRemainingInBillingCycle } from '@/lib/billing-cycle'

export async function GET() {
  try {
    // Get billing cycle configuration
    const billingStartDay = parseInt(process.env.CLAUDE_BILLING_CYCLE_START_DAY || '1')
    const currentCycle = getCurrentBillingCycle(billingStartDay)
    
    // Format dates for SQL (YYYY-MM-DD)
    const formatDateForSQL = (date: Date) => date.toISOString().split('T')[0]
    const cycleStartDate = formatDateForSQL(currentCycle.startDate)
    const cycleEndDate = formatDateForSQL(currentCycle.endDate)

    // Get aggregate totals (all time)
    const totalStats = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`,
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`,
        totalInputTokens: sql<number>`SUM(${usageRecords.inputTokens})::bigint`,
        totalOutputTokens: sql<number>`SUM(${usageRecords.outputTokens})::bigint`,
        totalCacheCreationTokens: sql<number>`SUM(${usageRecords.cacheCreationTokens})::bigint`,
        totalCacheReadTokens: sql<number>`SUM(${usageRecords.cacheReadTokens})::bigint`,
        recordCount: sql<number>`COUNT(*)::bigint`
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
        recordCount: sql<number>`COUNT(*)::bigint`
      })
      .from(usageRecords)
      .where(sql`${usageRecords.date} >= ${cycleStartDate} AND ${usageRecords.date} <= ${cycleEndDate}`)

    // Get daily records for charts and tables (last 30 days)
    const dailyRecords = await db
      .select({
        date: usageRecords.date,
        totalCost: usageRecords.totalCost,
        totalTokens: usageRecords.totalTokens,
        inputTokens: usageRecords.inputTokens,
        outputTokens: usageRecords.outputTokens,
        cacheCreationTokens: usageRecords.cacheCreationTokens,
        cacheReadTokens: usageRecords.cacheReadTokens,
        modelsUsed: usageRecords.modelsUsed,
        createdAt: usageRecords.createdAt
      })
      .from(usageRecords)
      .orderBy(desc(usageRecords.date))
      .limit(30)

    const totals = totalStats[0]
    const currentCycleTotals = currentCycleStats[0]
    
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

    // Calculate derived metrics
    const activeDays = Number(totals?.recordCount || 0)
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
        recordCount: activeDays,
        avgDailyCost
      },
      currentCycle: {
        totalCost: Number(currentCycleTotals?.totalCost || 0),
        totalTokens: Number(currentCycleTotals?.totalTokens || 0),
        totalInputTokens: Number(currentCycleTotals?.totalInputTokens || 0),
        totalOutputTokens: Number(currentCycleTotals?.totalOutputTokens || 0),
        totalCacheCreationTokens: Number(currentCycleTotals?.totalCacheCreationTokens || 0),
        totalCacheReadTokens: Number(currentCycleTotals?.totalCacheReadTokens || 0),
        recordCount: Number(currentCycleTotals?.recordCount || 0),
        avgDailyCost: Number(currentCycleTotals?.recordCount || 0) > 0 ? Number(currentCycleTotals?.totalCost || 0) / Number(currentCycleTotals?.recordCount || 0) : 0
      },
      daily: dailyData
    })
  } catch (error) {
    console.error('Error fetching usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics' },
      { status: 500 }
    )
  }
}