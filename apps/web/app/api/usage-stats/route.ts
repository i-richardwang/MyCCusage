import { NextResponse } from 'next/server'
import { db } from '@/src/db'
import { usageRecords } from '@/src/db/schema'
import { sql } from 'drizzle-orm'

export async function GET() {
  try {
    // Get total cost
    const totalCostResult = await db
      .select({
        totalCost: sql<number>`SUM(${usageRecords.totalCost})::numeric`
      })
      .from(usageRecords)

    // Get total tokens
    const totalTokensResult = await db
      .select({
        totalTokens: sql<number>`SUM(${usageRecords.totalTokens})::bigint`
      })
      .from(usageRecords)

    // Get record count
    const recordCountResult = await db
      .select({
        count: sql<number>`COUNT(*)::bigint`
      })
      .from(usageRecords)

    const totalCost = totalCostResult[0]?.totalCost || 0
    const totalTokens = totalTokensResult[0]?.totalTokens || 0
    const recordCount = recordCountResult[0]?.count || 0

    return NextResponse.json({
      totalCost: Number(totalCost),
      totalTokens: Number(totalTokens),
      recordCount: Number(recordCount)
    })
  } catch (error) {
    console.error('Error fetching usage stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics' },
      { status: 500 }
    )
  }
}