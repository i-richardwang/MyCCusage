import { CronExpressionParser, type CronFieldCollection } from "cron-parser";

export interface CalendarSchedule {
  minute: number[];
  hour: number[];
  day: number[];
  month: number[];
  weekday: number[];
}

/** A portable, five-field cron subset shared by both OS schedulers. */
export function parseSchedule(expression: string): CalendarSchedule {
  // Reject parser extensions (seconds, last/nth days, random values, aliases).
  if (
    expression.trim().split(/\s+/).length !== 5 ||
    !/^[\d\s*,/-]+$/.test(expression)
  ) {
    throw new Error("schedule must be a five-field numeric cron expression");
  }
  let fields: CronFieldCollection;
  try {
    fields = CronExpressionParser.parse(expression).fields;
  } catch {
    throw new Error(
      "schedule must be a valid five-field numeric cron expression",
    );
  }
  const schedule = {
    minute: [...fields.minute.values],
    hour: [...fields.hour.values],
    day: fields.dayOfMonth.values.map(Number),
    month: [...fields.month.values],
    weekday: [
      ...new Set(fields.dayOfWeek.values.map((day) => Number(day) % 7)),
    ],
  };
  // An unrestricted field is represented by an omitted calendar constraint.
  const limits = { minute: 60, hour: 24, day: 31, month: 12, weekday: 7 };
  for (const key of Object.keys(limits) as (keyof CalendarSchedule)[]) {
    if (schedule[key].length === limits[key]) schedule[key] = [];
  }
  if (
    schedule.weekday.length &&
    (schedule.day.length || schedule.month.length)
  ) {
    throw new Error(
      "schedule cannot combine weekday with day-of-month or month constraints across macOS and Linux",
    );
  }
  const combinations = Object.values(schedule).reduce(
    (count, values) => count * Math.max(1, values.length),
    1,
  );
  if (combinations > 4096)
    throw new Error("schedule must expand to at most 4096 calendar entries");
  return schedule;
}
