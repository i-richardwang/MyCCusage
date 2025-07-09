import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/db/index'
import { usageRecords } from '@/db/schema'
import { eq } from 'drizzle-orm'

interface DailyUsageRecord {
  date: string
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalTokens: number
  totalCost: number
  modelsUsed: string[]
  modelBreakdowns: Array<{
    modelName: string
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    cost: number
  }>
}

interface UsageSyncRequest {
  daily: DailyUsageRecord[]
  totals: {
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number
    totalCost: number
    totalTokens: number
  }
}

export async function POST(request: NextRequest) {
  try {
    // API Key validation
    const apiKey = request.headers.get('x-api-key')
    const expectedApiKey = process.env.API_KEY
    
    if (!expectedApiKey) {
      return NextResponse.json(
        { error: 'API key not configured on server' },
        { status: 500 }
      )
    }
    
    if (!apiKey || apiKey !== expectedApiKey) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      )
    }

    const body: UsageSyncRequest = await request.json()
    
    if (!body.daily || !Array.isArray(body.daily)) {
      return NextResponse.json(
        { error: 'Invalid request format: daily array is required' },
        { status: 400 }
      )
    }

    // Process each daily record
    const results = []
    
    for (const record of body.daily) {
      try {
        // Validate required fields
        if (!record.date || typeof record.totalTokens !== 'number' || typeof record.totalCost !== 'number') {
          results.push({
            date: record.date,
            status: 'error',
            message: 'Missing required fields'
          })
          continue
        }

        // Upsert record (update if exists, insert if not)
        const existingRecord = await db
          .select()
          .from(usageRecords)
          .where(eq(usageRecords.date, record.date))
          .limit(1)

        if (existingRecord.length > 0) {
          // Update existing record
          await db
            .update(usageRecords)
            .set({
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cacheCreationTokens: record.cacheCreationTokens,
              cacheReadTokens: record.cacheReadTokens,
              totalTokens: record.totalTokens,
              totalCost: record.totalCost.toString(),
              modelsUsed: record.modelsUsed,
              rawData: record,
              updatedAt: new Date()
            })
            .where(eq(usageRecords.date, record.date))
        } else {
          // Insert new record
          await db
            .insert(usageRecords)
            .values({
              date: record.date,
              inputTokens: record.inputTokens,
              outputTokens: record.outputTokens,
              cacheCreationTokens: record.cacheCreationTokens,
              cacheReadTokens: record.cacheReadTokens,
              totalTokens: record.totalTokens,
              totalCost: record.totalCost.toString(),
              modelsUsed: record.modelsUsed,
              rawData: record
            })
        }

        results.push({
          date: record.date,
          status: 'success'
        })
      } catch (error) {
        results.push({
          date: record.date,
          status: 'error',
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      results: results
    })

  } catch (error) {
    console.error('Usage sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}