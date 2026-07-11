import { useMemo } from "react";
import {
  DailyRecord,
  DeviceRecord,
  Device,
  TimeRange,
  RatioChartData,
  AgentType,
  AgentRecord,
  PieChartData,
} from "@/types/chart-types";
import {
  CHART_COLORS,
  TIME_RANGE_DAYS,
  INPUT_OUTPUT_RATIO_CHART_CONFIG,
  AGENT_CHART_CONFIG,
  CACHE_EFFICIENCY_CHART_CONFIG,
} from "@/constants/chart-config";
import { parseLocalDate, formatLocalDate } from "@/lib/date-utils";

// Shared utility for time range filtering
export function filterByTimeRange<T extends { date: string }>(
  data: T[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): T[] {
  if (timeRange === "all") {
    return data;
  }

  if (timeRange === "custom" && customDateRange) {
    return data.filter((item) => {
      const date = parseLocalDate(item.date);
      return date >= customDateRange.from && date <= customDateRange.to;
    });
  }

  return data.filter((item) => {
    const date = parseLocalDate(item.date);
    const referenceDate = new Date();
    const daysToSubtract = TIME_RANGE_DAYS[timeRange];
    const startDate = new Date(referenceDate);
    startDate.setDate(startDate.getDate() - daysToSubtract);
    return date >= startDate;
  });
}

// Generate all dates in a range for chart continuity
function generateDateRange(
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): string[] {
  if (timeRange === "all") {
    // For "all" range, return empty array - will be handled by existing data
    return [];
  }

  let startDate: Date;
  let endDate: Date;

  if (timeRange === "custom" && customDateRange) {
    startDate = new Date(customDateRange.from);
    endDate = new Date(customDateRange.to);
  } else {
    const today = new Date();
    const daysToSubtract = TIME_RANGE_DAYS[timeRange];
    startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysToSubtract);
    endDate = today;
  }

  const dates: string[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(formatLocalDate(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dates;
}

// Hook for single-device chart data
export function useSingleDeviceChartData(
  dailyData: DailyRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
) {
  return useMemo(() => {
    const chartData = dailyData
      .map((record) => ({
        date: record.date,
        cost: record.totalCost,
        tokens: record.totalTokens / 1000000, // Convert to millions
        inputTokens: record.inputTokens / 1000000,
        outputTokens: record.outputTokens / 1000000,
        cacheTokens:
          (record.cacheCreationTokens + record.cacheReadTokens) / 1000000,
      }))
      .reverse(); // Reverse array for chronological order

    return filterByTimeRange(chartData, timeRange, customDateRange);
  }, [dailyData, timeRange, customDateRange]);
}

// Shared builder for per-device daily series; cost and token charts only
// differ in which metric each record contributes.
function buildMultiDeviceSeries(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange: { from: Date; to: Date } | undefined,
  getValue: (record: DeviceRecord) => number,
) {
  // First filter device data by time range
  const filteredDeviceData = filterByTimeRange(
    deviceData,
    timeRange,
    customDateRange,
  );

  // Get active device IDs from filtered data
  const activeDeviceIds = new Set(
    filteredDeviceData.map((record) => record.deviceId),
  );

  // Filter devices to only include those with data in the selected time range
  const activeDevices = devices.filter((device) =>
    activeDeviceIds.has(device.deviceId),
  );

  // Group device data by date
  const dateGroups = filteredDeviceData.reduce(
    (acc, record) => {
      if (!acc[record.date]) {
        acc[record.date] = {};
      }
      acc[record.date]![record.deviceId] =
        (acc[record.date]![record.deviceId] || 0) + getValue(record);
      return acc;
    },
    {} as Record<string, Record<string, number>>,
  );

  // Generate complete date range for continuity
  const allDates =
    timeRange === "all"
      ? Array.from(
          new Set(filteredDeviceData.map((record) => record.date)),
        ).sort()
      : generateDateRange(timeRange, customDateRange);

  // Create complete chart data with zero-fill for missing dates
  const chartData = allDates.map((date) => {
    const dataPoint: Record<string, string | number> = { date };

    // Add data for each active device, defaulting to 0 if no data exists
    activeDevices.forEach((device) => {
      dataPoint[device.deviceId] = dateGroups[date]?.[device.deviceId] || 0;
    });

    return dataPoint;
  });

  // Generate chart configuration only for active devices
  const chartConfig = activeDevices.reduce(
    (config, device, index) => {
      const deviceName =
        device.displayName?.trim() ||
        device.deviceName ||
        `Device ${index + 1}`;
      config[device.deviceId] = {
        label: deviceName,
        color: CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0],
      };
      return config;
    },
    {} as Record<string, { label: string; color: string }>,
  );

  return {
    chartData,
    chartConfig,
    activeDevices, // Return filtered devices for chart rendering
  };
}

// Hook for multi-device cost chart data
export function useMultiDeviceChartData(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
) {
  return useMemo(
    () =>
      buildMultiDeviceSeries(
        deviceData,
        devices,
        timeRange,
        customDateRange,
        (record) => record.totalCost,
      ),
    [deviceData, devices, timeRange, customDateRange],
  );
}

// Hook for Input/Output ratio chart data
export function useInputOutputRatioChartData(
  dailyData: DailyRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): RatioChartData {
  return useMemo(() => {
    // Calculate daily ratios and running average
    const ratioData = dailyData
      .map((record) => {
        const ratio =
          record.outputTokens > 0
            ? record.inputTokens / record.outputTokens
            : 0;
        return {
          date: record.date,
          ratio: Number(ratio.toFixed(2)), // Round to 2 decimal places
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
        };
      })
      .reverse(); // Reverse for chronological order

    // Filter by time range first
    const filteredData = filterByTimeRange(
      ratioData,
      timeRange,
      customDateRange,
    );

    // Calculate cumulative average ratio (from start of filtered period)
    // in a single pass using running totals
    let cumulativeInput = 0;
    let cumulativeOutput = 0;
    const chartData = filteredData.map((record) => {
      cumulativeInput += record.inputTokens;
      cumulativeOutput += record.outputTokens;
      const averageRatio =
        cumulativeOutput > 0
          ? Number((cumulativeInput / cumulativeOutput).toFixed(2))
          : 0;

      return {
        date: record.date,
        ratio: record.ratio,
        averageRatio,
      };
    });

    return {
      chartData,
      chartConfig: INPUT_OUTPUT_RATIO_CHART_CONFIG,
    };
  }, [dailyData, timeRange, customDateRange]);
}

// Hook for multi-device token chart data (in millions of tokens)
export function useMultiDeviceTokenData(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
) {
  return useMemo(
    () =>
      buildMultiDeviceSeries(
        deviceData,
        devices,
        timeRange,
        customDateRange,
        (record) => record.totalTokens / 1000000,
      ),
    [deviceData, devices, timeRange, customDateRange],
  );
}

// Utility for filtering data by agent type
export function filterByAgent<T extends { agentType?: AgentType }>(
  data: T[],
  agentFilter: AgentType | "all",
): T[] {
  if (agentFilter === "all") return data;
  return data.filter((item) => item.agentType === agentFilter);
}

// Shared builder for agent distribution pie charts; token and cost variants
// only differ in the aggregated metric, tooltip label, and rounding.
function buildAgentPieData(
  agentData: AgentRecord[],
  timeRange: TimeRange,
  customDateRange: { from: Date; to: Date } | undefined,
  getValue: (record: AgentRecord) => number,
  valueLabel: string,
  roundValues: boolean,
): PieChartData {
  const filteredData = filterByTimeRange(agentData, timeRange, customDateRange);

  // Aggregate metric by agent type
  const agentTotals = filteredData.reduce(
    (acc, record) => {
      acc[record.agentType] = (acc[record.agentType] || 0) + getValue(record);
      return acc;
    },
    {} as Partial<Record<AgentType, number>>,
  );

  const total = Object.values(agentTotals).reduce(
    (sum, val) => sum + (val || 0),
    0,
  );

  const activeEntries = Object.entries(agentTotals).filter(
    ([, value]) => (value || 0) > 0,
  );

  const chartData = activeEntries.map(([agent]) => {
    const value = agentTotals[agent as AgentType] || 0;
    return {
      name: agent,
      value: roundValues ? Number(value.toFixed(2)) : value,
      fill: `var(--color-${agent})`,
    };
  });

  // Build config for active agents only
  const chartConfig = activeEntries.reduce(
    (config, [agent]) => {
      const agentKey = agent as AgentType;
      config[agentKey] = AGENT_CHART_CONFIG[agentKey];
      return config;
    },
    {} as Record<string, { label: string; color: string }>,
  );

  // Add the value key config for tooltip
  chartConfig.value = { label: valueLabel, color: "" };

  return { chartData, chartConfig, total };
}

// Hook for agent token distribution pie chart
export function useAgentTokenPieData(
  agentData: AgentRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): PieChartData {
  return useMemo(
    () =>
      buildAgentPieData(
        agentData,
        timeRange,
        customDateRange,
        (record) => record.totalTokens,
        "Tokens",
        false,
      ),
    [agentData, timeRange, customDateRange],
  );
}

// Hook for agent cost distribution pie chart
export function useAgentCostPieData(
  agentData: AgentRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): PieChartData {
  return useMemo(
    () =>
      buildAgentPieData(
        agentData,
        timeRange,
        customDateRange,
        (record) => record.totalCost,
        "Cost",
        true,
      ),
    [agentData, timeRange, customDateRange],
  );
}

// Hook for device cost distribution pie chart
export function useDeviceCostPieData(
  deviceData: DeviceRecord[],
  devices: Device[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): PieChartData {
  return useMemo(() => {
    const filteredData = filterByTimeRange(
      deviceData,
      timeRange,
      customDateRange,
    );

    // Aggregate cost by device
    const deviceTotals = filteredData.reduce(
      (acc, record) => {
        acc[record.deviceId] = (acc[record.deviceId] || 0) + record.totalCost;
        return acc;
      },
      {} as Record<string, number>,
    );

    const total = Object.values(deviceTotals).reduce(
      (sum, val) => sum + val,
      0,
    );

    // Build device name lookup
    const deviceNameMap = devices.reduce(
      (map, device) => {
        map[device.deviceId] =
          device.displayName?.trim() || device.deviceName || device.deviceId;
        return map;
      },
      {} as Record<string, string>,
    );

    const chartData = Object.entries(deviceTotals)
      .filter(([, value]) => value > 0)
      .map(([deviceId], index) => ({
        name: deviceId,
        value: Number((deviceTotals[deviceId] || 0).toFixed(2)),
        fill: CHART_COLORS[index % CHART_COLORS.length] || "var(--chart-1)",
      }));

    const chartConfig = Object.entries(deviceTotals)
      .filter(([, value]) => value > 0)
      .reduce(
        (config, [deviceId], index) => {
          config[deviceId] = {
            label: deviceNameMap[deviceId] || deviceId,
            color:
              CHART_COLORS[index % CHART_COLORS.length] || "var(--chart-1)",
          };
          return config;
        },
        {} as Record<string, { label: string; color: string }>,
      );

    chartConfig.value = { label: "Cost", color: "" };

    return { chartData, chartConfig, total };
  }, [deviceData, devices, timeRange, customDateRange]);
}

// Hook for cache efficiency pie chart (global)
export function useCacheEfficiencyPieData(
  dailyData: DailyRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
): PieChartData {
  return useMemo(() => {
    const filteredData = filterByTimeRange(
      dailyData,
      timeRange,
      customDateRange,
    );

    const aggregated = filteredData.reduce(
      (acc, record) => ({
        cacheRead: acc.cacheRead + record.cacheReadTokens,
        cacheCreation: acc.cacheCreation + record.cacheCreationTokens,
        input: acc.input + record.inputTokens,
      }),
      { cacheRead: 0, cacheCreation: 0, input: 0 },
    );

    // Non-cached input tokens = total input - cache read - cache creation
    const nonCached = Math.max(
      0,
      aggregated.input - aggregated.cacheRead - aggregated.cacheCreation,
    );
    const total = aggregated.cacheRead + aggregated.cacheCreation + nonCached;

    const chartData = [
      {
        name: "cacheRead",
        value: aggregated.cacheRead,
        fill: "var(--color-cacheRead)",
      },
      {
        name: "cacheCreation",
        value: aggregated.cacheCreation,
        fill: "var(--color-cacheCreation)",
      },
      { name: "nonCached", value: nonCached, fill: "var(--color-nonCached)" },
    ].filter((item) => item.value > 0);

    const chartConfig: Record<string, { label: string; color: string }> = {
      ...CACHE_EFFICIENCY_CHART_CONFIG,
      value: { label: "Tokens", color: "" },
    };

    return { chartData, chartConfig, total };
  }, [dailyData, timeRange, customDateRange]);
}

// Hook for multi-agent chart data
export function useMultiAgentChartData(
  agentData: AgentRecord[],
  timeRange: TimeRange,
  customDateRange?: { from: Date; to: Date },
) {
  return useMemo(() => {
    // Filter by time range first
    const filteredData = filterByTimeRange(
      agentData,
      timeRange,
      customDateRange,
    );

    // Get unique agents in filtered data
    const activeAgents = [...new Set(filteredData.map((r) => r.agentType))];

    // Group by date
    const dateGroups = filteredData.reduce(
      (acc, record) => {
        if (!acc[record.date]) acc[record.date] = {};
        acc[record.date]![record.agentType] =
          (acc[record.date]![record.agentType] || 0) + record.totalCost;
        return acc;
      },
      {} as Record<string, Partial<Record<AgentType, number>>>,
    );

    // Generate complete date range for continuity
    const allDates =
      timeRange === "all"
        ? Array.from(new Set(filteredData.map((record) => record.date))).sort()
        : generateDateRange(timeRange, customDateRange);

    // Create complete chart data with zero-fill for missing dates
    const chartData = allDates.map((date) => {
      const dataPoint: Record<string, string | number> = { date };
      activeAgents.forEach((agent) => {
        dataPoint[agent] = dateGroups[date]?.[agent] || 0;
      });
      return dataPoint;
    });

    // Generate chart config for active agents
    const chartConfig = activeAgents.reduce(
      (config, agent) => {
        config[agent] = AGENT_CHART_CONFIG[agent];
        return config;
      },
      {} as Record<string, { label: string; color: string }>,
    );

    return { chartData, chartConfig, activeAgents };
  }, [agentData, timeRange, customDateRange]);
}
