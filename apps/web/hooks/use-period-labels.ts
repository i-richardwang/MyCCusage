import { useMemo } from "react";
import { formatChartDate } from "@/lib/date-utils";
import type { Resolution } from "@/types/chart-types";

export interface PeriodLabels {
  // Short label for axis ticks and table rows
  tick: (period: string) => string;
  // Full label for tooltips
  full: (period: string) => string;
}

// Labels of days ("YYYY-MM-DD" account days) or hours (ISO instants, shown on
// the account's clocks)
export function usePeriodLabels(
  resolution: Resolution,
  timeZone: string,
): PeriodLabels {
  return useMemo(() => {
    if (resolution === "day") {
      return { tick: formatChartDate, full: formatChartDate };
    }
    const tick = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      hourCycle: "h23",
    });
    const full = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    return {
      tick: (period) => tick.format(new Date(period)),
      full: (period) => full.format(new Date(period)),
    };
  }, [resolution, timeZone]);
}
