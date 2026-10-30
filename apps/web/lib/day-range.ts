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

export function todayIn(timeZone: string, now: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
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
