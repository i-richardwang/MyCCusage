import type { Calendar } from "../calendar.js";
import type { AmpDayReport } from "./report.js";

// A day's report fetched this long after the day ended is final
const REPORT_FINAL_AFTER_MS = 60 * 60 * 1000;

export interface AmpUsageEntry {
  timestamp: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// Usage-only projection of `amp threads export`
export interface AmpThreadExport {
  id: string;
  created: number | null;
  // Message timestamps, marking the days the thread was active
  activity: string[];
  // Main-agent usage, one entry per assistant message
  usage: AmpUsageEntry[];
}

export interface AmpReportEntry {
  fetchedAt: string;
  // null when the report could not be parsed
  report: AmpDayReport | null;
}

// One cached thread: its export plus the usage reports of its active days
export interface AmpCachedThread extends AmpThreadExport {
  // `updated` from `amp threads list` when the thread was exported
  updated: string;
  // Usage reports by the absolute range they cover (see reportKey). A day
  // only uses the report of its exact range in the account calendar, so a
  // time zone change refetches instead of merging mismatched days.
  reports: Record<string, AmpReportEntry>;
}

// Thread ids become file names, so only accept Amp's `T-<uuid>` shape
export function isValidThreadId(id: string): boolean {
  return /^T-[A-Za-z0-9-]+$/.test(id);
}

function toTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

// Keep only message times and usage. Full exports carry the whole
// conversation (often hundreds of KB per thread).
export function projectThreadExport(
  raw: string,
  expectedId: string,
): AmpThreadExport {
  const thread = JSON.parse(raw) as Record<string, unknown>;
  if (thread.id !== expectedId) {
    throw new Error(`thread export has unexpected id ${String(thread.id)}`);
  }

  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const usage: AmpUsageEntry[] = [];
  const activity = new Set<string>();
  for (const message of messages as Array<Record<string, unknown>>) {
    const createdAt = message?.createdAt;
    if (typeof createdAt === "string" || typeof createdAt === "number") {
      const date = new Date(createdAt);
      if (!Number.isNaN(date.getTime())) activity.add(date.toISOString());
    }
    if (message?.role !== "assistant") continue;
    const u = message.usage as Record<string, unknown> | undefined;
    if (!u || typeof u.model !== "string" || !u.model) continue;
    usage.push({
      timestamp: typeof u.timestamp === "string" ? u.timestamp : null,
      model: u.model,
      inputTokens: toTokenCount(u.inputTokens),
      outputTokens: toTokenCount(u.outputTokens),
      cacheCreationTokens: toTokenCount(u.cacheCreationInputTokens),
      cacheReadTokens: toTokenCount(u.cacheReadInputTokens),
    });
  }

  return {
    id: expectedId,
    created: typeof thread.created === "number" ? thread.created : null,
    activity: [...activity].sort(),
    usage,
  };
}

export function usageDate(
  entry: AmpUsageEntry,
  created: number | null,
  calendar: Calendar,
): string | null {
  const parsed = entry.timestamp ? new Date(entry.timestamp) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return calendar.dayOf(parsed);
  return created ? calendar.dayOf(new Date(created)) : null;
}

// Days with any thread activity: every day subagents may have run
export function threadActiveDays(
  thread: AmpThreadExport,
  calendar: Calendar,
): string[] {
  const days = new Set<string>();
  for (const timestamp of thread.activity) {
    days.add(calendar.dayOf(new Date(timestamp)));
  }
  for (const entry of thread.usage) {
    const date = usageDate(entry, thread.created, calendar);
    if (date) days.add(date);
  }
  return [...days].sort();
}

// "<start ISO>/<end ISO>", the ISO 8601 interval a report was fetched for
export function reportKey([start, end]: [Date, Date]): string {
  return `${start.toISOString()}/${end.toISOString()}`;
}

export function dayReport(
  thread: AmpCachedThread,
  date: string,
  calendar: Calendar,
): AmpReportEntry | undefined {
  return thread.reports[reportKey(calendar.rangeOf(date))];
}

// A day's report is current when it was fetched after the thread's last
// update, or after the day was over (nothing can change then).
export function reportIsCurrent(
  thread: AmpCachedThread,
  date: string,
  calendar: Calendar,
): boolean {
  const entry = dayReport(thread, date, calendar);
  if (!entry) return false;
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  const dayEnd = calendar.rangeOf(date)[1].getTime();
  return (
    fetchedAt >= dayEnd + REPORT_FINAL_AFTER_MS ||
    fetchedAt >= new Date(thread.updated).getTime()
  );
}
