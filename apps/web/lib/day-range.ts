/**
 * Days are "YYYY-MM-DD" labels in the account calendar, the time zone the
 * collectors bucket usage in. Only "today" depends on that zone; all other day
 * arithmetic works on the labels themselves (in UTC, where every day has 24
 * hours), so the dashboard reads the same in every browser.
 */

// Inclusive range of days
export interface DayRange {
  from: string;
  to: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtc(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year!, month! - 1, date!);
}

function fromUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

// The fields an Intl format gives an instant, by part type
export function partsOf(
  format: Intl.DateTimeFormat,
  instant: Date,
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  return Object.fromEntries(
    format.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
}

export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = partsOf(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }),
    now,
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(day: string, days: number): string {
  return fromUtc(toUtc(day) + days * DAY_MS);
}

// Whole days from `from` to `to`; 0 on the same day
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

// The last `days` days, today included
export function lastDays(today: string, days: number): DayRange {
  return { from: addDays(today, 1 - days), to: today };
}

export function daysIn({ from, to }: DayRange): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

export function contains({ from, to }: DayRange, day: string): boolean {
  return day >= from && day <= to;
}

const QUARTER_HOUR_MS = 15 * 60 * 1000;
// Every UTC offset lies within ±14h of UTC midnight
const MAX_OFFSET_MS = 15 * 60 * 60 * 1000;

// The ISO instant every hour of the range starts on the account's clocks, in
// order. Offsets are whole quarter hours, so hours start on quarter-hour
// instants whose local minute is zero; DST days have 23 or 25 of them.
export function hoursIn({ from, to }: DayRange, timeZone: string): string[] {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    // Without the hour, the minute is not formatted
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
  });
  const hours: string[] = [];
  const end = toUtc(to) + DAY_MS + MAX_OFFSET_MS;
  for (let time = toUtc(from) - MAX_OFFSET_MS; time < end; time += QUARTER_HOUR_MS) {
    const instant = new Date(time);
    const parts = partsOf(format, instant);
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    if (parts.minute === "00" && date >= from && date <= to) {
      hours.push(instant.toISOString());
    }
  }
  return hours;
}
