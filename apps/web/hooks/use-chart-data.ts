import { useMemo } from "react";
import {
  ChartConfig,
  Device,
  HourlyChartData,
  RatioChartData,
  PieChartData,
  UsageRecord,
  UsageMetrics,
} from "@/types/chart-types";
import { type AgentType } from "@/types/agent-types";
import {
  CHART_COLORS,
  INPUT_OUTPUT_RATIO_CHART_CONFIG,
  AGENT_CHART_CONFIG,
  CACHE_EFFICIENCY_CHART_CONFIG,
} from "@/constants/chart-config";
import { isActive, type UsageView } from "@/lib/usage-view";

function seriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function deviceLabel(device: Device): string {
  return device.displayName?.trim() || device.deviceName;
}

function sumBy<K extends string>(
  records: UsageRecord[],
  key: (record: UsageRecord) => K,
  getValue: (record: UsageMetrics) => number,
): Map<K, number> {
  const totals = new Map<K, number>();
  for (const record of records) {
    const k = key(record);
    totals.set(k, (totals.get(k) ?? 0) + getValue(record));
  }
  return totals;
}

// One point per day of the view, with a value per series; days without usage
// are zero
function dailySeries<K extends string>(
  view: UsageView,
  key: (record: UsageRecord) => K,
  getValue: (record: UsageMetrics) => number,
): { chartData: Record<string, string | number>[]; keys: K[] } {
  const byDate = new Map<string, Map<K, number>>();
  for (const record of view.records) {
    const values = byDate.get(record.date) ?? new Map<K, number>();
    const k = key(record);
    values.set(k, (values.get(k) ?? 0) + getValue(record));
    byDate.set(record.date, values);
  }
  const keys = [...new Set(view.records.map(key))];
  const chartData = view.daily.map(({ date }) => {
    const point: Record<string, string | number> = { date };
    for (const k of keys) point[k] = byDate.get(date)?.get(k) ?? 0;
    return point;
  });
  return { chartData, keys };
}

// Per-device daily series; cost and token charts only differ in which metric
// each record contributes. Only devices with usage in the view get a series.
function buildMultiDeviceSeries(
  view: UsageView,
  devices: Device[],
  getValue: (record: UsageMetrics) => number,
) {
  const { chartData, keys } = dailySeries(
    view,
    (record) => record.deviceId,
    getValue,
  );
  const activeDevices = devices.filter((device) =>
    keys.includes(device.deviceId),
  );
  const chartConfig = activeDevices.reduce((config, device, index) => {
    config[device.deviceId] = {
      label: deviceLabel(device),
      color: seriesColor(index),
    };
    return config;
  }, {} as ChartConfig);

  return { chartData, chartConfig, activeDevices };
}

// Hook for multi-device cost chart data
export function useMultiDeviceChartData(view: UsageView, devices: Device[]) {
  return useMemo(
    () => buildMultiDeviceSeries(view, devices, (record) => record.totalCost),
    [view, devices],
  );
}

// Hook for multi-device token chart data (in millions of tokens)
export function useMultiDeviceTokenData(view: UsageView, devices: Device[]) {
  return useMemo(
    () =>
      buildMultiDeviceSeries(
        view,
        devices,
        (record) => record.totalTokens / 1000000,
      ),
    [view, devices],
  );
}

// Hook for multi-agent cost chart data
export function useMultiAgentChartData(view: UsageView) {
  return useMemo(() => {
    const { chartData, keys: activeAgents } = dailySeries(
      view,
      (record) => record.agentType,
      (record) => record.totalCost,
    );
    const chartConfig = activeAgents.reduce((config, agent) => {
      config[agent] = AGENT_CHART_CONFIG[agent];
      return config;
    }, {} as ChartConfig);

    return { chartData, chartConfig, activeAgents };
  }, [view]);
}

// Hook for hourly token chart data (in millions of tokens): one point per
// hour of the view, stacked by agent. Null when the range is too long.
export function useHourlyChartData(view: UsageView): HourlyChartData | null {
  return useMemo(() => {
    if (!view.hourly) return null;
    const byHour = new Map<string, Map<AgentType, number>>();
    for (const record of view.hourly.records) {
      const values =
        byHour.get(record.hourStart) ?? new Map<AgentType, number>();
      values.set(
        record.agentType,
        (values.get(record.agentType) ?? 0) + record.totalTokens / 1000000,
      );
      byHour.set(record.hourStart, values);
    }
    const activeAgents = [
      ...new Set(view.hourly.records.map(({ agentType }) => agentType)),
    ];
    const chartData = view.hourly.hours.map((hourStart) => {
      const point: Record<string, string | number> = { hourStart };
      for (const agent of activeAgents) {
        point[agent] = byHour.get(hourStart)?.get(agent) ?? 0;
      }
      return point;
    });
    const chartConfig = activeAgents.reduce((config, agent) => {
      config[agent] = AGENT_CHART_CONFIG[agent];
      return config;
    }, {} as ChartConfig);
    return { chartData, chartConfig, activeAgents };
  }, [view]);
}

// Hook for Input/Output ratio chart data, over the days with usage
export function useInputOutputRatioChartData(view: UsageView): RatioChartData {
  return useMemo(() => {
    // Average ratio from the start of the range, in a single pass using
    // running totals
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    const chartData = view.daily.filter(isActive).map((day) => {
      cumulativeInput += day.inputTokens;
      cumulativeOutput += day.outputTokens;
      return {
        date: day.date,
        ratio:
          day.outputTokens > 0 ? round2(day.inputTokens / day.outputTokens) : 0,
        averageRatio:
          cumulativeOutput > 0 ? round2(cumulativeInput / cumulativeOutput) : 0,
      };
    });

    return {
      chartData,
      chartConfig: INPUT_OUTPUT_RATIO_CHART_CONFIG,
    };
  }, [view]);
}

// Shared builder for distribution pie charts: one slice per key with a
// positive total
function buildPieData<K extends string>(
  totals: Map<K, number>,
  slice: (key: K, index: number) => { label: string; color: string },
  valueLabel: string,
  roundValues: boolean,
): PieChartData {
  const slices = [...totals]
    .filter(([, value]) => value > 0)
    .map(([key, value], index) => ({ key, value, ...slice(key, index) }));

  const chartData = slices.map(({ key, value, color }) => ({
    name: key,
    value: roundValues ? round2(value) : value,
    fill: color,
  }));

  const chartConfig: ChartConfig = Object.fromEntries(
    slices.map(({ key, label, color }) => [key, { label, color }]),
  );
  // The value key config for tooltip
  chartConfig.value = { label: valueLabel, color: "" };

  const total = slices.reduce((sum, { value }) => sum + value, 0);
  return { chartData, chartConfig, total };
}

function buildAgentPieData(
  view: UsageView,
  getValue: (record: UsageMetrics) => number,
  valueLabel: string,
  roundValues: boolean,
): PieChartData {
  return buildPieData(
    sumBy(view.records, (record) => record.agentType, getValue),
    (agent) => AGENT_CHART_CONFIG[agent],
    valueLabel,
    roundValues,
  );
}

// Hook for agent token distribution pie chart
export function useAgentTokenPieData(view: UsageView): PieChartData {
  return useMemo(
    () =>
      buildAgentPieData(view, (record) => record.totalTokens, "Tokens", false),
    [view],
  );
}

// Hook for agent cost distribution pie chart
export function useAgentCostPieData(view: UsageView): PieChartData {
  return useMemo(
    () => buildAgentPieData(view, (record) => record.totalCost, "Cost", true),
    [view],
  );
}

// Hook for device cost distribution pie chart
export function useDeviceCostPieData(
  view: UsageView,
  devices: Device[],
): PieChartData {
  return useMemo(() => {
    const labels = new Map(
      devices.map((device) => [device.deviceId, deviceLabel(device)]),
    );
    return buildPieData(
      sumBy(
        view.records,
        (record) => record.deviceId,
        (record) => record.totalCost,
      ),
      (deviceId, index) => ({
        label: labels.get(deviceId) || deviceId,
        color: seriesColor(index),
      }),
      "Cost",
      true,
    );
  }, [view, devices]);
}

// Hook for cache efficiency pie chart
export function useCacheEfficiencyPieData(view: UsageView): PieChartData {
  return useMemo(() => {
    const { cacheReadTokens, cacheCreationTokens, inputTokens } = view.summary;

    // Input already excludes cache reads and writes
    const nonCached = inputTokens;
    const total = cacheReadTokens + cacheCreationTokens + nonCached;

    const chartData = [
      {
        name: "cacheRead",
        value: cacheReadTokens,
        fill: "var(--color-cacheRead)",
      },
      {
        name: "cacheCreation",
        value: cacheCreationTokens,
        fill: "var(--color-cacheCreation)",
      },
      { name: "nonCached", value: nonCached, fill: "var(--color-nonCached)" },
    ].filter((item) => item.value > 0);

    const chartConfig: ChartConfig = {
      ...CACHE_EFFICIENCY_CHART_CONFIG,
      value: { label: "Tokens", color: "" },
    };

    return { chartData, chartConfig, total };
  }, [view]);
}
