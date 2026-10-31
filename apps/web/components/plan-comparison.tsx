"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  formatCurrency,
  formatSavings,
  type SubscriptionPeriod,
} from "@/lib/cumulative-metrics";
import type { UsageSummary } from "@/lib/usage-view";
import {
  getUserStatusByAmount,
  getSubscriptionPlan,
  getPlanPricing,
  type UserStatus,
  type UserTier,
} from "@/constants/business-config";
import { type AgentType } from "@/types/agent-types";
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
  summary: UsageSummary;
  subscriptionPeriod: SubscriptionPeriod;
  isAllTime: boolean;
  agentFilter: AgentType | "all";
}

export function PlanComparison({
  summary,
  subscriptionPeriod,
  isAllTime,
  agentFilter,
}: PlanComparisonProps) {
  const subscriptionPlan = getSubscriptionPlan();
  const planPrice = getPlanPricing(subscriptionPlan);

  // All time compares against the whole subscription, by its monthly average;
  // any other period against one month of the plan
  const avgMonthlyCost = summary.totalCost / subscriptionPeriod.totalMonths;

  const vsPlan = isAllTime
    ? summary.totalCost - planPrice * subscriptionPeriod.totalMonths
    : summary.totalCost - planPrice;

  const userStatus: UserStatus = getUserStatusByAmount(
    isAllTime ? avgMonthlyCost : summary.totalCost,
  );

  const IconComponent = STATUS_ICONS[userStatus.tier];

  const getVsPlanValue = () => {
    if (isAllTime) {
      return formatSavings(vsPlan).text;
    }
    return vsPlan > 0
      ? `+${formatCurrency(Math.abs(vsPlan))}`
      : `-${formatCurrency(Math.abs(vsPlan))}`;
  };

  const getVsPlanColor = () => {
    if (isAllTime) {
      return formatSavings(vsPlan).colorClass;
    }
    return vsPlan > 0 ? "text-primary" : "text-muted-foreground";
  };

  const getDaysDisplay = () => {
    if (isAllTime) {
      return (
        <>
          {subscriptionPeriod.totalDays}{" "}
          <span className="text-sm font-normal">days</span>
        </>
      );
    }
    return (
      <>
        {summary.activeDays}{" "}
        <span className="text-sm font-normal">active days</span>
      </>
    );
  };

  const getDaysSubtitle = () => {
    if (isAllTime) {
      return `Since ${subscriptionPeriod.startDate.toLocaleDateString()}`;
    }
    return "In selected period";
  };

  // Check if current agent uses PAYG model (opencode, amp)
  const isPaygAgent = agentFilter === "opencode" || agentFilter === "amp";

  // Calculate Tokens per Dollar (for PAYG agents)
  const tokensPerDollar =
    summary.totalCost > 0 ? summary.totalTokens / summary.totalCost : 0;

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
                    {formatCurrency(summary.totalCost)}
                  </CardTitle>
                  <CardDescription>
                    {isAllTime
                      ? `Avg: ${formatCurrency(avgMonthlyCost)}/month`
                      : `Avg: ${formatCurrency(summary.avgDailyCost)}/day`}
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
                    {formatCurrency(summary.avgDailyCost)}
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
