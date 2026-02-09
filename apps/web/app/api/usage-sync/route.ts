import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { devices, usageRecords } from '@/src/db/schema'
import { sql } from 'drizzle-orm'
import type { UsageSyncRequest, UsageSyncResponse, UsageSyncResult } from '@/types/api-types'

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

    // Validate request format
    if (!body.device?.deviceId || !body.device?.deviceName) {
      return NextResponse.json(
        { error: 'Invalid request format: device information is required' },
        { status: 400 }
      )
    }

    if (!Array.isArray(body.daily)) {
      return NextResponse.json(
        { error: 'Invalid request format: daily array is required' },
        { status: 400 }
      )
    }

    // Upsert device using onConflictDoUpdate
    await db
      .insert(devices)
      .values({
        deviceId: body.device.deviceId,
        deviceName: body.device.deviceName,
        displayName: body.device.displayName
      })
      .onConflictDoUpdate({
        target: devices.deviceId,
        set: {
          deviceName: sql`excluded.device_name`,
          displayName: sql`excluded.display_name`,
          updatedAt: new Date()
        }
      })

    // Get agent type from request, default to 'claude-code' for backward compatibility
    const agentType = body.device.agentType || 'claude-code'

    // Filter and validate records
    const validRecords = body.daily.filter(
      record => record.date && typeof record.totalTokens === 'number' && typeof record.totalCost === 'number'
    )

    const invalidRecords = body.daily.filter(
      record => !record.date || typeof record.totalTokens !== 'number' || typeof record.totalCost !== 'number'
    )

    const results: UsageSyncResult[] = []

    // Add invalid records to results
    invalidRecords.forEach(record => {
      results.push({
        date: record.date || 'unknown',
        status: 'error',
        message: 'Missing required fields'
      })
    })

    // Batch upsert valid records
    if (validRecords.length > 0) {
      const recordsToInsert = validRecords.map(record => ({
        deviceId: body.device.deviceId,
        agentType: agentType,
        date: record.date,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheCreationTokens: record.cacheCreationTokens,
        cacheReadTokens: record.cacheReadTokens,
        totalTokens: record.totalTokens,
        totalCost: record.totalCost.toString(),
        credits: record.credits?.toString() || '0',
        modelsUsed: record.modelsUsed,
        rawData: record
      }))

      try {
        await db
          .insert(usageRecords)
          .values(recordsToInsert)
          .onConflictDoUpdate({
            target: [usageRecords.deviceId, usageRecords.date, usageRecords.agentType],
            set: {
              inputTokens: sql`excluded.input_tokens`,
              outputTokens: sql`excluded.output_tokens`,
              cacheCreationTokens: sql`excluded.cache_creation_tokens`,
              cacheReadTokens: sql`excluded.cache_read_tokens`,
              totalTokens: sql`excluded.total_tokens`,
              totalCost: sql`excluded.total_cost`,
              credits: sql`excluded.credits`,
              modelsUsed: sql`excluded.models_used`,
              rawData: sql`excluded.raw_data`,
              updatedAt: new Date()
            }
          })

        // All valid records succeeded
        validRecords.forEach(record => {
          results.push({
            date: record.date,
            status: 'success'
          })
        })
      } catch (error) {
        // If batch insert fails, mark all as error
        validRecords.forEach(record => {
          results.push({
            date: record.date,
            status: 'error',
            message: error instanceof Error ? error.message : 'Batch insert failed'
          })
        })
      }
    }

    const response: UsageSyncResponse = {
      success: true,
      processed: results.length,
      results
    }

    return NextResponse.json(response)

  } catch (error) {
    console.error('Usage sync error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
