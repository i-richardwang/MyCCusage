import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords } from '@/src/db/schema'
import { sql, desc } from 'drizzle-orm'

export async function GET() {
  try {
    // Get aggregate totals
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