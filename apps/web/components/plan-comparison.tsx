"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  calculateCumulativeMetrics,
  getCumulativeUserStatus,
  formatCurrency,
  formatSavings,
  PLAN_PRICING,
  getUserStatusByAmount
} from "@/lib/cumulative-metrics"
import type { CumulativeData, Last30DaysMetrics } from "@/types/api-types"
import type { UserStatus, UserTier } from "@/constants/business-config"
import { Crown, Zap, Users, Lightbulb, CreditCard, Calculator, Calendar, LucideIcon } from "lucide-react"

type ROIMode = 'last30days' | 'current' | 'cumulative'

const STATUS_ICONS: Record<UserTier, LucideIcon> = {
  'Heavy User': Crown,
  'Power User': Zap,
  'Regular User': Users,
  'Light User': Lightbulb
}

interface PlanComparisonProps {
  currentCycleCost: number
  previousCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
  cumulativeData?: CumulativeData
  billingStartDate?: string
  last30DaysData?: Last30DaysMetrics
}

export function PlanComparison({
  currentCycleCost,
  previousCycleCost,
  billingCycleLabel,
  daysRemaining,
  cumulativeData,
  billingStartDate,
  last30DaysData
}: PlanComparisonProps) {
  const [roiMode, setROIMode] = useState<ROIMode>('last30days')

  // Calculate cumulative metrics if data is available
  const cumulativeMetrics = cumulativeData && billingStartDate
    ? calculateCumulativeMetrics(cumulativeData, billingStartDate)
    : null

  // Last 30 days values
  const last30DaysCost = last30DaysData?.totalCost || 0
  const last30DaysActiveDays = last30DaysData?.activeDays || 0

  // Current cycle calculations
  const currentVs100 = currentCycleCost - PLAN_PRICING.MAX_100
  const currentVs200 = currentCycleCost - PLAN_PRICING.MAX_200
  const monthlyChange = currentCycleCost - previousCycleCost
  const monthlyChangePercent = previousCycleCost > 0 ? ((monthlyChange / previousCycleCost) * 100) : 0

  // Last 30 days calculations
  const last30DaysVs100 = last30DaysCost - PLAN_PRICING.MAX_100
  const last30DaysVs200 = last30DaysCost - PLAN_PRICING.MAX_200

  // Determine mode flags
  const isLast30DaysMode = roiMode === 'last30days'
  const isCurrentMode = roiMode === 'current'
  const isCumulativeMode = roiMode === 'cumulative'

  // Get user status based on mode
  const userStatus: UserStatus = isCumulativeMode
    ? getCumulativeUserStatus(cumulativeMetrics?.avgMonthlyCost || 0)
    : getUserStatusByAmount(last30DaysCost)

  // Format savings for cumulative mode
  const vs100Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs100) : null
  const vs200Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs200) : null

  const IconComponent = STATUS_ICONS[userStatus.tier]

  // Helper to format value comparison
  const formatValueComparison = (value: number): string => {
    return value > 0
      ? `+${formatCurrency(Math.abs(value))}`
      : `-${formatCurrency(Math.abs(value))}`
  }

  // Get display values based on mode
  const getApiValueConsumed = () => {
    if (isLast30DaysMode) return formatCurrency(last30DaysCost)
    if (isCurrentMode) return formatCurrency(currentCycleCost)
    return formatCurrency(cumulativeMetrics?.totalCostAllTime || 0)
  }

  const getVs100Value = () => {
    if (isLast30DaysMode) return formatValueComparison(last30DaysVs100)
    if (isCurrentMode) return formatValueComparison(currentVs100)
    return vs100Savings?.text || '$0.00'
  }

  const getVs200Value = () => {
    if (isLast30DaysMode) return formatValueComparison(last30DaysVs200)
    if (isCurrentMode) return formatValueComparison(currentVs200)
    return vs200Savings?.text || '$0.00'
  }

  const getVs100Color = () => {
    if (isLast30DaysMode) return last30DaysVs100 > 0 ? 'text-primary' : 'text-muted-foreground'
    if (isCurrentMode) return currentVs100 > 0 ? 'text-primary' : 'text-muted-foreground'
    return vs100Savings?.colorClass || 'text-muted-foreground'
  }

  const getVs200Color = () => {
    if (isLast30DaysMode) return last30DaysVs200 > 0 ? 'text-primary' : 'text-muted-foreground'
    if (isCurrentMode) return currentVs200 > 0 ? 'text-primary' : 'text-muted-foreground'
    return vs200Savings?.colorClass || 'text-muted-foreground'
  }

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Subscription ROI Dashboard</CardTitle>
          <CardDescription>
            Track your subscription returns - how much value you&apos;re harvesting!
          </CardDescription>
        </div>
        <Tabs value={roiMode} onValueChange={(value) => setROIMode(value as ROIMode)}>
          <TabsList>
            <TabsTrigger value="last30days">Last 30 Days</TabsTrigger>
            <TabsTrigger value="current">Current Cycle</TabsTrigger>
            <TabsTrigger value="cumulative">Since Start</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        {/* User Status */}
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${userStatus.tier === 'Light User' ? 'bg-muted' : 'bg-primary/10'}`}>
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
            Based on {isCumulativeMode ? 'avg monthly' : 'last 30 days'} usage
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* API Value Consumed */}
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>API Value Consumed</CardDescription>
                  <CardTitle className="text-3xl">{getApiValueConsumed()}</CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      `Avg: ${formatCurrency(last30DaysData?.avgDailyCost || 0)}/day`
                    ) : isCurrentMode ? (
                      <>
                        vs last month:
                        <span className={`ml-1 ${monthlyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {monthlyChangePercent >= 0 ? '+' : ''}{monthlyChangePercent.toFixed(1)}%
                        </span>
                      </>
                    ) : (
                      `Avg: ${formatCurrency(cumulativeMetrics?.avgMonthlyCost || 0)}/month`
                    )}
                  </CardDescription>
                </div>
                <CreditCard className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          {/* vs $100 Plan */}
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>vs Max ${PLAN_PRICING.MAX_100}/month</CardDescription>
                  <CardTitle className={`text-3xl ${getVs100Color()}`}>
                    {getVs100Value()}
                  </CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      last30DaysVs100 > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : isCurrentMode ? (
                      currentVs100 > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : (
                      vs100Savings?.description || 'No data'
                    )}
                  </CardDescription>
                </div>
                <Calculator className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          {/* vs $200 Plan */}
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>vs Max ${PLAN_PRICING.MAX_200}/month</CardDescription>
                  <CardTitle className={`text-3xl ${getVs200Color()}`}>
                    {getVs200Value()}
                  </CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      last30DaysVs200 > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : isCurrentMode ? (
                      currentVs200 > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : (
                      vs200Savings?.description || 'No data'
                    )}
                  </CardDescription>
                </div>
                <Calculator className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          {/* Days / Activity */}
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>
                    {isLast30DaysMode ? 'Active Days' : isCurrentMode ? 'Billing Cycle' : 'Subscription Days'}
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {isLast30DaysMode ? (
                      <>{last30DaysActiveDays} <span className="text-sm font-normal">of 30 days</span></>
                    ) : isCurrentMode ? (
                      <>{daysRemaining ?? 0} <span className="text-sm font-normal">days remaining</span></>
                    ) : (
                      <>{cumulativeMetrics?.totalSubscriptionDays || 0} <span className="text-sm font-normal">days</span></>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      `${((last30DaysActiveDays / 30) * 100).toFixed(0)}% activity rate`
                    ) : isCurrentMode ? (
                      billingCycleLabel
                    ) : (
                      cumulativeMetrics?.subscriptionStartDate
                        ? `Since ${cumulativeMetrics.subscriptionStartDate.toLocaleDateString()}`
                        : 'No data'
                    )}
                  </CardDescription>
                </div>
                <Calendar className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}
