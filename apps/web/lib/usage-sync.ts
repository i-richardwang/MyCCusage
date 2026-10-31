/**
 * Validation of usage uploads. An upload carries one device's usage of one
 * agent as buckets: an hour of the account calendar (hourStart set) or a whole
 * day, per model.
 *
 *   { version, device, timezone, range?, buckets: [{ date, hourStart?, model,
 *     inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
 *     reasoningTokens?, cost, requests? }] }
 *
 * The upload replaces every stored bucket of the device's agent on the days of
 * its range and of its buckets, so it is accepted or rejected as a whole:
 * storing part of it would delete the rest of those days. With backfillBefore,
 * earlier days with existing device/agent usage are preserved in full.
 */

import { AGENT_TYPES, type AgentType } from "@/src/db/schema";
import { daysBetween, daysIn, isDay, partsOf, todayIn } from "@/lib/day-range";
import type { UsageSyncDevice } from "@/types/api-types";

// Upload format the dashboard accepts; collectors refuse dashboards that speak
// another
export const SYNC_PROTOCOL = 2;

// A range covers at most this many days
const MAX_RANGE_DAYS = 400;
const MAX_MODEL_LENGTH = 255;

// A stored bucket, before the database adds its bookkeeping columns
export interface BucketRow {
  date: string;
  hourStart: Date | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number | null;
  totalTokens: number;
  cost: number;
  requests: number | null;
}

export interface ParsedUpload {
  device: UsageSyncDevice;
  // Days whose stored buckets the upload replaces, in order
  days: string[];
  buckets: BucketRow[];
  backfillBefore?: string;
}

export type ParseResult =
  | { ok: true; upload: ParsedUpload }
  | { ok: false; error: string };

class UploadError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function amount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new UploadError(`${field} must be a non-negative number`);
  }
  return value;
}

const count = (value: unknown, field: string) =>
  Math.round(amount(value, field));

function optionalCount(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : count(value, field);
}

function day(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDay(value)) {
    throw new UploadError(`${field} must be a YYYY-MM-DD day`);
  }
  return value;
}

// The start of an hour on the account's clocks, lying in `date`
function hourStart(value: unknown, date: string, timeZone: string): Date {
  const instant = typeof value === "string" ? new Date(value) : null;
  if (!instant || Number.isNaN(instant.getTime())) {
    throw new UploadError("hourStart must be an ISO instant");
  }
  const parts = partsOf(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      minute: "2-digit",
      second: "2-digit",
    }),
    instant,
  );
  if (
    parts.minute !== "00" ||
    parts.second !== "00" ||
    instant.getUTCMilliseconds() !== 0
  ) {
    throw new UploadError(
      `hourStart ${value} does not start an hour in ${timeZone}`,
    );
  }
  if (todayIn(timeZone, instant) !== date) {
    throw new UploadError(
      `hourStart ${value} is not on ${date} in ${timeZone}`,
    );
  }
  return instant;
}

function parseBucket(value: unknown, timeZone: string): BucketRow {
  if (!isRecord(value)) throw new UploadError("Every bucket must be an object");
  const date = day(value.date, "date");
  const model = value.model ?? "";
  if (typeof model !== "string" || model.length > MAX_MODEL_LENGTH) {
    throw new UploadError(
      `model must be a string of at most ${MAX_MODEL_LENGTH} characters`,
    );
  }
  const inputTokens = count(value.inputTokens, "inputTokens");
  const outputTokens = count(value.outputTokens, "outputTokens");
  const cacheCreationTokens = count(
    value.cacheCreationTokens,
    "cacheCreationTokens",
  );
  const cacheReadTokens = count(value.cacheReadTokens, "cacheReadTokens");
  return {
    date,
    hourStart:
      value.hourStart === undefined || value.hourStart === null
        ? null
        : hourStart(value.hourStart, date, timeZone),
    model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    reasoningTokens: optionalCount(value.reasoningTokens, "reasoningTokens"),
    totalTokens:
      inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens,
    cost: amount(value.cost, "cost"),
    requests: optionalCount(value.requests, "requests"),
  };
}

function parseDevice(value: unknown): UsageSyncDevice {
  if (
    !isRecord(value) ||
    typeof value.deviceId !== "string" ||
    !value.deviceId ||
    typeof value.deviceName !== "string" ||
    !value.deviceName
  ) {
    throw new UploadError(
      "Invalid request format: device information is required",
    );
  }
  if (!AGENT_TYPES.includes(value.agentType as AgentType)) {
    throw new UploadError(`Invalid agent type: ${String(value.agentType)}`);
  }
  return {
    deviceId: value.deviceId,
    deviceName: value.deviceName,
    ...(typeof value.displayName === "string"
      ? { displayName: value.displayName }
      : {}),
    agentType: value.agentType as AgentType,
  };
}

function parseRange(value: unknown): string[] {
  if (!isRecord(value)) throw new UploadError("range must be an object");
  const from = day(value.from, "range.from");
  const to = day(value.to, "range.to");
  const span = daysBetween(from, to) + 1;
  if (span < 1 || span > MAX_RANGE_DAYS) {
    throw new UploadError(`range must cover 1 to ${MAX_RANGE_DAYS} days`);
  }
  return daysIn({ from, to });
}

export function parseUpload(body: unknown, timeZone: string): ParseResult {
  try {
    if (!isRecord(body)) throw new UploadError("Invalid request format");
    if (body.version !== SYNC_PROTOCOL) {
      throw new UploadError(
        `Unsupported sync protocol ${String(body.version ?? "none")}; this dashboard speaks ${SYNC_PROTOCOL}. Update the collector.`,
      );
    }
    const device = parseDevice(body.device);
    // Dates are only comparable across devices cut in one calendar
    if (body.timezone !== timeZone) {
      throw new UploadError(
        `Usage must be bucketed in the account time zone ${timeZone}, got ${String(body.timezone || "none")}`,
      );
    }
    if (!Array.isArray(body.buckets)) {
      throw new UploadError(
        "Invalid request format: buckets array is required",
      );
    }

    const backfillBefore =
      body.backfillBefore === undefined
        ? undefined
        : day(body.backfillBefore, "backfillBefore");
    const buckets = body.buckets.map((bucket) => parseBucket(bucket, timeZone));
    const days = new Set(
      body.range === undefined ? [] : parseRange(body.range),
    );
    const keys = new Set<string>();
    for (const bucket of buckets) {
      const key = `${bucket.date}\0${bucket.hourStart?.toISOString() ?? ""}\0${bucket.model}`;
      if (keys.has(key)) {
        throw new UploadError(
          `Duplicate bucket for ${bucket.model || "unattributed usage"} on ${bucket.hourStart?.toISOString() ?? bucket.date}`,
        );
      }
      keys.add(key);
      days.add(bucket.date);
    }
    return {
      ok: true,
      upload: {
        device,
        days: [...days].sort(),
        buckets,
        ...(backfillBefore ? { backfillBefore } : {}),
      },
    };
  } catch (error) {
    if (error instanceof UploadError)
      return { ok: false, error: error.message };
    throw error;
  }
}

// Existing history belongs to a whole device/agent/day, not individual models
// or hours. Call after locking the device row in the upload transaction.
export function selectUploadDays(
  upload: ParsedUpload,
  existingDays: readonly string[],
): ParsedUpload {
  const cutoff = upload.backfillBefore;
  if (!cutoff) return upload;
  const existing = new Set(existingDays);
  const writable = (date: string) => date >= cutoff || !existing.has(date);
  return {
    ...upload,
    days: upload.days.filter(writable),
    buckets: upload.buckets.filter((bucket) => writable(bucket.date)),
  };
}
