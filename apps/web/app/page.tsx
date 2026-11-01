"use client";

import { useState, useMemo } from "react";
import { useUsageStats } from "@/hooks/use-usage-stats";
import { PlanComparison } from "@/components/plan-comparison";
import { UsageOverview } from "@/components/usage-overview";
import { UsageTrend } from "@/components/usage-trend";
import { UsageTotals } from "@/components/usage-totals";
import { UsageBreakdown } from "@/components/usage-breakdown";
import { ModelDialog } from "@/components/model-dialog";
import { GlobalFilterBar } from "@/components/global-filter-bar";
import { ModeToggle } from "@/components/mode-toggle";
import { Footer } from "@/components/footer";
import type {
  Resolution,
  TrendGroup,
  UsageMetric,
} from "@/types/chart-types";
import { useDeviceSeries } from "@/hooks/use-chart-data";
import { type AgentType } from "@/types/agent-types";
import type { UsageStatsResponse } from "@/types/api-types";
import { type DateRange } from "react-day-picker";
import { formatLocalDate, parseLocalDate } from "@/lib/date-utils";
import { todayIn } from "@/lib/day-range";
import { getSubscriptionPeriod } from "@/lib/cumulative-metrics";
import {
  periodRange,
  selectUsage,
  viewResolution,
  type ModelTotals,
  type Period,
} from "@/lib/usage-view";
import { Loader2 } from "lucide-react";

function Dashboard({ stats }: { stats: UsageStatsResponse }) {
  const [period, setPeriod] = useState<Period>("30d");
  // The calendar's selection while it is still incomplete
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const [agentFilter, setAgentFilter] = useState<AgentType | "all">("all");
  const [metric, setMetric] = useState<UsageMetric>("cost");
  const [group, setGroup] = useState<TrendGroup>("agent");
  // Days or hours as chosen for the current period; null until chosen
  const [chosenResolution, setChosenResolution] = useState<Resolution | null>(
    null,
  );
  const [selectedModel, setSelectedModel] = useState<
    Pick<ModelTotals, "agentType" | "model"> | null
  >(null);

  // "Today" in the account calendar, the zone the collectors bucket days in
  const today = todayIn(stats.timezone);

  const range = useMemo(
    () => periodRange(period, today, stats.records),
    [period, today, stats.records],
  );

  // Every card, chart and table shows this view
  const view = useMemo(
    () => selectUsage(stats, agentFilter, range),
    [stats, agentFilter, range],
  );

  const deviceSeries = useDeviceSeries(view, stats.devices);

  const resolution = viewResolution(view, chosenResolution);
  // Hours are recorded per agent
  const trendGroup: TrendGroup = resolution === "hour" ? "agent" : group;

  // The selected model as the current view counts it
  const model =
    selectedModel &&
    (view.models.find(
      (candidate) =>
        candidate.agentType === selectedModel.agentType &&
        candidate.model === selectedModel.model,
    ) ??
      null);

  const subscriptionPeriod = useMemo(
    () => getSubscriptionPeriod(stats.billingStartDate, today),
    [stats.billingStartDate, today],
  );

  const isAllTime = period === "all";

  // The calendar works in browser-local dates; only their calendar day counts
  const calendarRange: DateRange | undefined =
    draft ??
    (isAllTime
      ? undefined
      : { from: parseLocalDate(range.from), to: parseLocalDate(range.to) });

  // A new period starts at the resolution its length suggests
  const selectPeriod = (next: Period) => {
    setPeriod(next);
    setDraft(undefined);
    setChosenResolution(null);
  };

  const handleCalendarChange = (selection: DateRange | undefined) => {
    if (selection?.from && selection.to) {
      selectPeriod({
        from: formatLocalDate(selection.from),
        to: formatLocalDate(selection.to),
      });
    } else {
      setDraft(selection);
    }
  };

  return (
    <>
      <GlobalFilterBar
        timeRange={typeof period === "string" ? period : "custom"}
        onTimeRangeChange={selectPeriod}
        dateRange={calendarRange}
        onDateRangeChange={handleCalendarChange}
        agentFilter={agentFilter}
        onAgentFilterChange={setAgentFilter}
        metric={metric}
        onMetricChange={setMetric}
      />

      <PlanComparison
        summary={view.summary}
        subscriptionPeriod={subscriptionPeriod}
        isAllTime={isAllTime}
        agentFilter={agentFilter}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <UsageOverview view={view} metric={metric} deviceSeries={deviceSeries} />
        <div className="lg:col-span-2">
          <UsageTrend
            view={view}
            metric={metric}
            deviceSeries={deviceSeries}
            group={trendGroup}
            onGroupChange={setGroup}
            resolution={resolution}
            onResolutionChange={setChosenResolution}
            timeZone={stats.timezone}
          />
        </div>
      </div>

      <UsageTotals summary={view.summary} />

      <UsageBreakdown
        view={view}
        metric={metric}
        resolution={resolution}
        timeZone={stats.timezone}
        onSelectModel={setSelectedModel}
      />

      <ModelDialog
        model={model}
        view={view}
        metric={metric}
        onClose={() => setSelectedModel(null)}
      />
    </>
  );
}

export default function Page() {
  const { stats, loading, error } = useUsageStats();

  const renderMainContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-red-500">Error: {error}</div>
        </div>
      );
    }

    if (!stats) {
      return (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-lg">No data available</div>
        </div>
      );
    }

    return <Dashboard stats={stats} />;
  };

  return (
    <div className="min-h-screen">
      <div className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                {process.env.NEXT_PUBLIC_OWNER_NAME
                  ? `${process.env.NEXT_PUBLIC_OWNER_NAME}'s Coding Usage Dashboard`
                  : "Coding Usage Dashboard"}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <ModeToggle />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-8 space-y-8">
        {renderMainContent()}
      </div>

      <Footer />
    </div>
  );
}
