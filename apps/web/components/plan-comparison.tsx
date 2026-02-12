"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  getSubscriptionPeriod,
  formatCurrency,
  formatSavings,
  getUserStatusByAmount,
  getSubscriptionPlan,
  getPlanPricing,
} from "@/lib/cumulative-metrics";
import type { AggregatedMetrics } from "@/types/api-types";
import type { UserStatus, UserTier } from "@/constants/business-config";
import type { AgentType } from "@/types/chart-types";
import {
  Crown,
  Zap,
  Users,
  Lightbulb,
  Calculator,
  Calendar,
  TrendingUp,
  Coins,
  LucideIcon,
} from "lucide-react";

const STATUS_ICONS: Record<UserTier, LucideIcon> = {
  "Heavy User": Crown,
  "Power User": Zap,
  "Regular User": Users,
  "Light User": Lightbulb,
};

interface PlanComparisonProps {
  filteredMetrics?: AggregatedMetrics;
  billingStartDate?: string;
  isAllTime?: boolean;
  agentFilter?: AgentType | "all";
}

export function PlanComparison({
  filteredMetrics,
  billingStartDate,
  isAllTime = false,
  agentFilter = "all",
}: PlanComparisonProps) {
  const subscriptionPlan = getSubscriptionPlan();
  const planPrice = getPlanPricing(subscriptionPlan);

  const subscriptionPeriod = billingStartDate
    ? getSubscriptionPeriod(billingStartDate)
    : null;

  const activeCost = filteredMetrics?.totalCost || 0;
  const activeActiveDays = filteredMetrics?.activeDays || 0;
  const activeAvgDailyCost = filteredMetrics?.avgDailyCost || 0;

  // In "All Time" mode, calculate monthly average and vs Plan over full subscription
  const avgMonthlyCost =
    isAllTime && subscriptionPeriod
      ? activeCost / subscriptionPeriod.totalMonths
      : 0;

  const vsPlan =
    isAllTime && subscriptionPeriod
      ? activeCost - planPrice * subscriptionPeriod.totalMonths
      : activeCost - planPrice;

  const userStatus: UserStatus =
    isAllTime && subscriptionPeriod
      ? getUserStatusByAmount(avgMonthlyCost)
      : getUserStatusByAmount(activeCost);

  const IconComponent = STATUS_ICONS[userStatus.tier];

  const getVsPlanValue = () => {
    if (isAllTime && subscriptionPeriod) {
      return formatSavings(vsPlan).text;
    }
    return vsPlan > 0
      ? `+${formatCurrency(Math.abs(vsPlan))}`
      : `-${formatCurrency(Math.abs(vsPlan))}`;
  };

  const getVsPlanColor = () => {
    if (isAllTime && subscriptionPeriod) {
      return formatSavings(vsPlan).colorClass;
    }
    return vsPlan > 0 ? "text-primary" : "text-muted-foreground";
  };

  const getDaysDisplay = () => {
    if (isAllTime && subscriptionPeriod) {
      return (
        <>
          {subscriptionPeriod.totalDays}{" "}
          <span className="text-sm font-normal">days</span>
        </>
      );
    }
    return (
      <>
        {activeActiveDays}{" "}
        <span className="text-sm font-normal">active days</span>
      </>
    );
  };

  const getDaysSubtitle = () => {
    if (isAllTime && subscriptionPeriod) {
      return `Since ${subscriptionPeriod.startDate.toLocaleDateString()}`;
    }
    return "In selected period";
  };

  // Check if current agent uses PAYG model (opencode, amp)
  const isPaygAgent = agentFilter === "opencode" || agentFilter === "amp";

  // Calculate Tokens per Dollar (for PAYG agents)
  const tokensPerDollar =
    activeCost > 0 ? (filteredMetrics?.totalTokens || 0) / activeCost : 0;

  const formatTokensPerDollar = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toFixed(0);
  };

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Subscription ROI Dashboard</CardTitle>
          <CardDescription>
            Track your subscription returns - how much value you&apos;re
            harvesting!
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 ${userStatus.tier === "Light User" ? "bg-muted" : "bg-primary/10"}`}
            >
              <IconComponent className={`w-5 h-5 ${userStatus.color}`} />
            </div>
            <div>
              <div className={`text-lg font-semibold ${userStatus.color}`}>
                {userStatus.title}
              </div>
              <div className="text-sm text-muted-foreground">
                {userStatus.subtitle}
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            Based on {isAllTime ? "avg monthly" : "period"} usage
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>API Value Consumed</CardDescription>
                  <CardTitle className="text-3xl">
                    {formatCurrency(activeCost)}
                  </CardTitle>
                  <CardDescription>
                    {isAllTime && subscriptionPeriod
                      ? `Avg: ${formatCurrency(avgMonthlyCost)}/month`
                      : `Avg: ${formatCurrency(activeAvgDailyCost)}/day`}
                  </CardDescription>
                </div>
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                {isPaygAgent ? (
                  <div className="space-y-1">
                    <CardDescription>Tokens per Dollar</CardDescription>
                    <CardTitle className="text-3xl text-primary">
                      {formatTokensPerDollar(tokensPerDollar)}
                    </CardTitle>
                    <CardDescription>Cost efficiency metric</CardDescription>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <CardDescription>
                      vs Max ${subscriptionPlan}/month
                    </CardDescription>
                    <CardTitle className={`text-3xl ${getVsPlanColor()}`}>
                      {getVsPlanValue()}
                    </CardTitle>
                    <CardDescription>
                      {vsPlan > 0 ? "Bonus Value!" : "Almost there!"}
                    </CardDescription>
                  </div>
                )}
                {isPaygAgent ? (
                  <Coins className="h-6 w-6 text-muted-foreground" />
                ) : (
                  <Calculator className="h-6 w-6 text-muted-foreground" />
                )}
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>Average Daily Cost</CardDescription>
                  <CardTitle className="text-3xl">
                    {formatCurrency(activeAvgDailyCost)}
                  </CardTitle>
                  <CardDescription>Daily average analysis</CardDescription>
                </div>
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>
                    {isAllTime ? "Subscription Days" : "Active Days"}
                  </CardDescription>
                  <CardTitle className="text-3xl">{getDaysDisplay()}</CardTitle>
                  <CardDescription>{getDaysSubtitle()}</CardDescription>
                </div>
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>
        </div>
      </CardContent>
    </Card>
  );
}
