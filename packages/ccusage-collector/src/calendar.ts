// The account calendar: how instants become the "YYYY-MM-DD" days the
// dashboard stores. The dashboard owns the time zone, so every source on
// every device buckets usage the same way, independent of the process TZ.
export interface Calendar {
  readonly timeZone: string;
  dayOf(instant: Date): string;
  // [start, end) of a day; DST days are 23 or 25 hours long
  rangeOf(day: string): [Date, Date];
}

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HOUR_MS = 60 * 60 * 1000;
// Every UTC offset lies within ±14h, so a day starts within this distance of
// its UTC midnight.
const MAX_OFFSET_MS = 15 * HOUR_MS;

// UTC midnight of a day label, which also names the day in every zone
function utcMidnight(day: string): number {
  const match = DAY_PATTERN.exec(day);
  const time = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : NaN;
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid day: ${day}`);
  }
  return time;
}

function nextDay(day: string): string {
  return new Date(utcMidnight(day) + 24 * HOUR_MS).toISOString().slice(0, 10);
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function createCalendar(timeZone: string): Calendar {
  if (!isTimeZone(timeZone)) {
    throw new Error(`Unknown time zone: ${timeZone}`);
  }
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  function dayOf(instant: Date): string {
    const parts = Object.fromEntries(
      format.formatToParts(instant).map(({ type, value }) => [type, value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  // First millisecond whose day is `day` or later. dayOf never decreases
  // over time, so a binary search also finds starts that DST moved off
  // midnight.
  function startOf(day: string): Date {
    const midnight = utcMidnight(day);
    let low = midnight - MAX_OFFSET_MS;
    let high = midnight + MAX_OFFSET_MS;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (dayOf(new Date(mid)) < day) low = mid + 1;
      else high = mid;
    }
    return new Date(low);
  }

  function rangeOf(day: string): [Date, Date] {
    return [startOf(day), startOf(nextDay(day))];
  }

  return { timeZone, dayOf, rangeOf };
}
