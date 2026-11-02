"use client";

import { useEffect, useState } from "react";
import type { DayRange } from "@/lib/day-range";
import { showsHours, type HoursLoad } from "@/lib/usage-view";
import type { UsageHoursResponse } from "@/types/api-types";

const LOADING: HoursLoad = { status: "loading" };

// The hours of a range shown hour by hour, loaded once per range; null for a
// range too long to show them
export function useUsageHours({ from, to }: DayRange): HoursLoad | null {
  const shown = showsHours({ from, to });
  const [loads, setLoads] = useState<Record<string, HoursLoad>>({});
  const load = loads[`${from}/${to}`];
  const pending = shown && !load;

  useEffect(() => {
    if (!pending) return;
    const controller = new AbortController();
    const settle = (next: HoursLoad) =>
      setLoads((current) => ({ ...current, [`${from}/${to}`]: next }));
    fetch(`/api/usage-hours?${new URLSearchParams({ from, to })}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to fetch usage hours");
        const { hourly }: UsageHoursResponse = await response.json();
        settle({ status: "loaded", records: hourly });
      })
      .catch(() => {
        if (!controller.signal.aborted) settle({ status: "failed" });
      });
    return () => controller.abort();
  }, [pending, from, to]);

  return shown ? (load ?? LOADING) : null;
}
