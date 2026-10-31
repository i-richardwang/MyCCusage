import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/src/db'
import { devices, usageBuckets } from '@/src/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { UsageSyncResponse } from '@/types/api-types'
import { getAccountTimeZone } from '@/lib/account-timezone'
import { parseUpload, SYNC_PROTOCOL } from '@/lib/usage-sync'

// Rows per insert statement, well below PostgreSQL's parameter limit
const INSERT_CHUNK = 1000

// Constant-time secret comparison; hashing first makes it length-independent
function safeKeyCompare(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

// API key validation; returns an error response, or null when authorized
function authorize(request: NextRequest): NextResponse | null {
  const apiKey = request.headers.get('x-api-key')
  const expectedApiKey = process.env.API_KEY

  if (!expectedApiKey) {
    return NextResponse.json(
      { error: 'API key not configured on server' },
      { status: 500 }
    )
  }

  if (!apiKey || !safeKeyCompare(apiKey, expectedApiKey)) {
    return NextResponse.json(
      { error: 'Invalid API key' },
      { status: 401 }
    )
  }
  return null
}

// Collectors read the account time zone before collecting, so every device
// buckets days and hours in the same calendar, and the upload format the
// dashboard accepts
export async function GET(request: NextRequest) {
  const unauthorized = authorize(request)
  if (unauthorized) return unauthorized
  try {
    return NextResponse.json({
      timezone: getAccountTimeZone(),
      protocol: SYNC_PROTOCOL
    })
  } catch (error) {
    console.error('Account time zone error:', error)
    return NextResponse.json(
      { error: 'Account time zone is misconfigured on server' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const unauthorized = authorize(request)
    if (unauthorized) return unauthorized

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Invalid request format: body must be JSON' },
        { status: 400 }
      )
    }

    const parsed = parseUpload(body, getAccountTimeZone())
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const { device, days, buckets } = parsed.upload

    await db.transaction(async (tx) => {
      await tx
        .insert(devices)
        .values({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          displayName: device.displayName
        })
        .onConflictDoUpdate({
          target: devices.deviceId,
          set: {
            deviceName: sql`excluded.device_name`,
            displayName: sql`excluded.display_name`,
            updatedAt: new Date()
          }
        })

      // The upload states these days completely: hours, models and day
      // buckets it does not report go
      if (days.length > 0) {
        await tx
          .delete(usageBuckets)
          .where(
            and(
              eq(usageBuckets.deviceId, device.deviceId),
              eq(usageBuckets.agentType, device.agentType),
              inArray(usageBuckets.date, days)
            )
          )
      }
      for (let i = 0; i < buckets.length; i += INSERT_CHUNK) {
        await tx.insert(usageBuckets).values(
          buckets.slice(i, i + INSERT_CHUNK).map((bucket) => ({
            ...bucket,
            deviceId: device.deviceId,
            agentType: device.agentType,
            cost: bucket.cost.toFixed(6)
          }))
        )
      }
    })

    const response: UsageSyncResponse = {
      success: true,
      days,
      buckets: buckets.length
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
