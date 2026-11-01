import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/src/db";
import { devices, usageBuckets } from "@/src/db/schema";
import { planUsageWrite, type ParsedUpload } from "@/lib/usage-sync";
import type { UsageSyncResponse } from "@/types/api-types";

// Keep inserts below PostgreSQL's parameter limit.
const INSERT_CHUNK = 1000;

export async function storeUsage(
  upload: ParsedUpload,
): Promise<Omit<UsageSyncResponse, "success">> {
  const { device } = upload;

  return db.transaction(async (tx) => {
    await tx
      .insert(devices)
      .values({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        displayName: device.displayName,
      })
      .onConflictDoUpdate({
        target: devices.deviceId,
        set: {
          deviceName: sql`excluded.device_name`,
          displayName: sql`excluded.display_name`,
          updatedAt: new Date(),
        },
      });

    // The device upsert holds its row lock through commit, serializing
    // concurrent uploads before deciding which historical days are missing.
    const existing =
      upload.backfillBefore && upload.days.length > 0
        ? await tx
            .selectDistinct({ date: usageBuckets.date })
            .from(usageBuckets)
            .where(
              and(
                eq(usageBuckets.deviceId, device.deviceId),
                eq(usageBuckets.agentType, device.agentType),
                inArray(usageBuckets.date, upload.days),
              ),
            )
        : [];
    const { days, buckets } = planUsageWrite(
      upload,
      existing.map(({ date }) => date),
    );

    // The upload states these days completely: hours, models and day
    // buckets it does not report go
    if (days.length > 0) {
      await tx
        .delete(usageBuckets)
        .where(
          and(
            eq(usageBuckets.deviceId, device.deviceId),
            eq(usageBuckets.agentType, device.agentType),
            inArray(usageBuckets.date, days),
          ),
        );
    }
    for (let i = 0; i < buckets.length; i += INSERT_CHUNK) {
      await tx.insert(usageBuckets).values(
        buckets.slice(i, i + INSERT_CHUNK).map((bucket) => ({
          ...bucket,
          deviceId: device.deviceId,
          agentType: device.agentType,
          cost: bucket.cost.toFixed(6),
        })),
      );
    }
    return { days, buckets: buckets.length };
  });
}
