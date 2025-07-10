import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { devices, usageRecords } from '@/src/db/schema'
import { eq, and } from 'drizzle-orm'
import type { UsageData } from 'ccusage-collector'

type UsageSyncRequest = UsageData

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
    
    if (!body.device || !body.device.deviceId || !body.device.deviceName) {
      return NextResponse.json(
        { error: 'Invalid request format: device information is required' },
        { status: 400 }
      )
    }
    
    if (!body.daily || !Array.isArray(body.daily)) {
      return NextResponse.json(
        { error: 'Invalid request format: daily array is required' },
        { status: 400 }
      )
    }

    // Ensure device exists in database (upsert device)
    const existingDevice = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, body.device.deviceId))
      .limit(1)

    if (existingDevice.length === 0) {
      // Create new device
      await db
        .insert(devices)
        .values({
          deviceId: body.device.deviceId,
          deviceName: body.device.deviceName
        })
      console.log(`Created new device: ${body.device.deviceName} (${body.device.deviceId})`)
    } else {
      // Update device name if changed
      const currentDevice = existingDevice[0]
      if (currentDevice && currentDevice.deviceName !== body.device.deviceName) {
        await db
          .update(devices)
          .set({
            deviceName: body.device.deviceName,
            updatedAt: new Date()
          })
          .where(eq(devices.deviceId, body.device.deviceId))
        console.log(`Updated device name: ${body.device.deviceName} (${body.device.deviceId})`)
      }
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

        // Upsert record (update if exists for this device+date, insert if not)
        const existingRecord = await db
          .select()
          .from(usageRecords)
          .where(and(
            eq(usageRecords.deviceId, body.device.deviceId),
            eq(usageRecords.date, record.date)
          ))
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
            .where(and(
              eq(usageRecords.deviceId, body.device.deviceId),
              eq(usageRecords.date, record.date)
            ))
        } else {
          // Insert new record
          await db
            .insert(usageRecords)
            .values({
              deviceId: body.device.deviceId,
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