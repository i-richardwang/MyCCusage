"use client";

import { useState, useMemo } from "react";
import { useUsageStats } from "@/hooks/use-usage-stats";
import { StatsCards } from "@/components/stats-cards";
import { PlanComparison } from "@/components/plan-comparison";
import { Charts } from "@/components/charts";
import { RecentActivity } from "@/components/recent-activity";
import { HourlyUsage } from "@/components/hourly-usage";
import { ModelUsage } from "@/components/model-usage";
import { GlobalFilterBar } from "@/components/global-filter-bar";
import { ModeToggle } from "@/components/mode-toggle";
import { Footer } from "@/components/footer";
import { AgentType, PresetRange } from "@/types/chart-types";
import type { UsageStatsResponse } from "@/types/api-types";
import { type DateRange } from "react-day-picker";
import { formatLocalDate, parseLocalDate } from "@/lib/date-utils";
import { todayIn } from "@/lib/day-range";
import { getSubscriptionPeriod } from "@/lib/cumulative-metrics";
import { periodRange, selectUsage, type Period } from "@/lib/usage-view";
import { Loader2 } from "lucide-react";

function Dashboard({ stats }: { stats: UsageStatsResponse }) {
  const [period, setPeriod] = useState<Period>("30d");
  // The calendar's selection while it is still incomplete
  const [draft, setDraft] = useState<DateRange | undefined>(undefined);
  const [agentFilter, setAgentFilter] = useState<AgentType | "all">("all");

  // "Today" in the account calendar, the zone the collectors bucket days in
  const today = useMemo(() => todayIn(stats.timezone), [stats.timezone]);

  const range = useMemo(
    () => periodRange(period, today, stats.records),
    [period, today, stats.records],
  );

  // Every card, chart and table shows this view
  const view = useMemo(
    () => selectUsage(stats, agentFilter, range),
    [stats, agentFilter, range],
  );

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

  const handlePresetChange = (preset: PresetRange) => {
    setPeriod(preset);
    setDraft(undefined);
  };

  const handleCalendarChange = (selection: DateRange | undefined) => {
    if (selection?.from && selection.to) {
      setPeriod({
        from: formatLocalDate(selection.from),
        to: formatLocalDate(selection.to),
      });
      setDraft(undefined);
    } else {
      setDraft(selection);
    }
  };

  return (
    <>
      <GlobalFilterBar
        timeRange={typeof period === "string" ? period : "custom"}
        onTimeRangeChange={handlePresetChange}
        dateRange={calendarRange}
        onDateRangeChange={handleCalendarChange}
        agentFilter={agentFilter}
        onAgentFilterChange={setAgentFilter}
      />

      <PlanComparison
        summary={view.summary}
        subscriptionPeriod={subscriptionPeriod}
        isAllTime={isAllTime}
        agentFilter={agentFilter}
      />

      <StatsCards summary={view.summary} />

      <HourlyUsage view={view} timeZone={stats.timezone} />

      <Charts view={view} devices={stats.devices} agentFilter={agentFilter} />

      <ModelUsage models={view.models} />

      <RecentActivity daily={view.daily} />
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
