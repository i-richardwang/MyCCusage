import { useMemo } from "react";
import type {
  ChartConfig,
  Device,
  Resolution,
  SeriesChartData,
  TrendGroup,
  UsageMetric,
  UsageMetrics,
} from "@/types/chart-types";
import { AGENT_TYPES, type AgentType } from "@/types/agent-types";
import {
  AGENT_CHART_CONFIG,
  CHART_COLORS,
  TOKEN_TYPE_CONFIG,
} from "@/constants/chart-config";
import type { ShareSegment } from "@/components/share-bar";
import { metricValue } from "@/lib/format";
import {
  addUsage,
  isActive,
  NO_USAGE,
  type UsageView,
} from "@/lib/usage-view";

function deviceLabel(device: Device): string {
  return device.displayName?.trim() || device.deviceName;
}

// Devices with usage in the view, labelled and colored in the view's order
export function useDeviceSeries(view: UsageView, devices: Device[]) {
  return useMemo(() => {
    const labels = new Map(
      devices.map((device) => [device.deviceId, deviceLabel(device)]),
    );
    return Object.fromEntries(
      view.devices.map(({ deviceId }, index) => [
        deviceId,
        {
          label: labels.get(deviceId) ?? deviceId,
          color: CHART_COLORS[index % CHART_COLORS.length]!,
        },
      ]),
    ) as ChartConfig;
  }, [view, devices]);
}

// The given agents, in their display order
function agentSeries(agents: AgentType[]): ChartConfig {
  const present = new Set(agents);
  return Object.fromEntries(
    AGENT_TYPES.filter((agent) => present.has(agent)).map((agent) => [
      agent,
      AGENT_CHART_CONFIG[agent],
    ]),
  );
}

interface Keyed extends UsageMetrics {
  period: string;
  key: string;
}

// One point per period, with the metric of each key in it; periods without
// usage are zero
function stack(
  periods: string[],
  entries: Keyed[],
  metric: UsageMetric,
  chartConfig: ChartConfig,
): SeriesChartData {
  const byPeriod = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const values = byPeriod.get(entry.period) ?? new Map<string, number>();
    values.set(
      entry.key,
      (values.get(entry.key) ?? 0) + metricValue(metric, entry),
    );
    byPeriod.set(entry.period, values);
  }
  const chartData = periods.map((period) => {
    const point: Record<string, string | number> = { period };
    for (const key of Object.keys(chartConfig)) {
      point[key] = byPeriod.get(period)?.get(key) ?? 0;
    }
    return point;
  });
  return { chartData, chartConfig };
}

// The trend chart: the metric per day, stacked by agent or device, or per
// hour, stacked by agent, the only grouping hours are recorded in
export function useTrendData(
  view: UsageView,
  deviceSeries: ChartConfig,
  metric: UsageMetric,
  group: TrendGroup,
  resolution: Resolution,
): SeriesChartData {
  return useMemo(() => {
    if (resolution === "hour" && view.hourly) {
      const { hours, records } = view.hourly;
      return stack(
        hours,
        records.map((record) => ({
          ...record,
          period: record.hourStart,
          key: record.agentType,
        })),
        metric,
        agentSeries(records.map(({ agentType }) => agentType)),
      );
    }
    const days = view.daily.map(({ date }) => date);
    if (group === "device") {
      return stack(
        days,
        view.records.map((record) => ({
          ...record,
          period: record.date,
          key: record.deviceId,
        })),
        metric,
        deviceSeries,
      );
    }
    return stack(
      days,
      view.records.map((record) => ({
        ...record,
        period: record.date,
        key: record.agentType,
      })),
      metric,
      agentSeries(view.agents.map(({ agentType }) => agentType)),
    );
  }, [view, deviceSeries, metric, group, resolution]);
}

// A period's usage, in total and per agent
export interface PeriodUsage extends UsageMetrics {
  period: string;
  byAgent: Partial<Record<AgentType, UsageMetrics>>;
}

// The days or hours with usage, latest first, for the breakdown table
export function usePeriodBreakdown(
  view: UsageView,
  resolution: Resolution,
): PeriodUsage[] {
  return useMemo(() => {
    const entries =
      resolution === "hour" && view.hourly
        ? view.hourly.records.map((record) => ({
            ...record,
            period: record.hourStart,
          }))
        : view.records.map((record) => ({ ...record, period: record.date }));
    const byPeriod = new Map<string, PeriodUsage>();
    for (const entry of entries) {
      const usage = byPeriod.get(entry.period) ?? {
        period: entry.period,
        ...NO_USAGE,
        byAgent: {},
      };
      byPeriod.set(entry.period, {
        ...usage,
        ...addUsage(usage, entry),
        byAgent: {
          ...usage.byAgent,
          [entry.agentType]: addUsage(
            usage.byAgent[entry.agentType] ?? NO_USAGE,
            entry,
          ),
        },
      });
    }
    return [...byPeriod.values()]
      .filter(isActive)
      .sort((a, b) => b.period.localeCompare(a.period));
  }, [view, resolution]);
}

// Tokens of each type; together they make the total
export function tokenTypeSegments(usage: UsageMetrics): ShareSegment[] {
  return (
    Object.keys(TOKEN_TYPE_CONFIG) as (keyof typeof TOKEN_TYPE_CONFIG)[]
  ).map((type) => ({ ...TOKEN_TYPE_CONFIG[type], value: usage[type] }));
}
