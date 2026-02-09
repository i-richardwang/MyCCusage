"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  calculateCumulativeMetrics,
  getCumulativeUserStatus,
  formatCurrency,
  formatSavings,
  getUserStatusByAmount,
  getSubscriptionPlan,
  getPlanPricing
} from "@/lib/cumulative-metrics"
import type { CumulativeData, AggregatedMetrics } from "@/types/api-types"
import type { UserStatus, UserTier } from "@/constants/business-config"
import { Crown, Zap, Users, Lightbulb, CreditCard, Calculator, Calendar, TrendingUp, LucideIcon } from "lucide-react"

const STATUS_ICONS: Record<UserTier, LucideIcon> = {
  'Heavy User': Crown,
  'Power User': Zap,
  'Regular User': Users,
  'Light User': Lightbulb
}

interface PlanComparisonProps {
  cumulativeData?: CumulativeData
  billingStartDate?: string
  filteredMetrics?: AggregatedMetrics
  isAllTime?: boolean
}

export function PlanComparison({
  cumulativeData,
  billingStartDate,
  filteredMetrics,
  isAllTime = false
}: PlanComparisonProps) {
  const subscriptionPlan = getSubscriptionPlan()
  const planPrice = getPlanPricing(subscriptionPlan)

  const cumulativeMetrics = cumulativeData && billingStartDate
    ? calculateCumulativeMetrics(cumulativeData, billingStartDate)
    : null

  const activeMetrics = filteredMetrics || null
  const activeCost = activeMetrics?.totalCost || 0
  const activeActiveDays = activeMetrics?.activeDays || 0
  const activeAvgDailyCost = activeMetrics?.avgDailyCost || 0

  const vsPlan = activeCost - planPrice

  const userStatus: UserStatus = isAllTime && cumulativeMetrics
    ? getCumulativeUserStatus(cumulativeMetrics.avgMonthlyCost)
    : getUserStatusByAmount(activeCost)

  const vsPlanSavings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVsPlan) : null

  const IconComponent = STATUS_ICONS[userStatus.tier]

  const formatValueComparison = (value: number): string => {
    return value > 0
      ? `+${formatCurrency(Math.abs(value))}`
      : `-${formatCurrency(Math.abs(value))}`
  }

  const getApiValueConsumed = () => {
    if (isAllTime && cumulativeMetrics) {
      return formatCurrency(cumulativeMetrics.totalCostAllTime)
    }
    return formatCurrency(activeCost)
  }

  const getVsPlanValue = () => {
    if (isAllTime && vsPlanSavings) {
      return vsPlanSavings.text
    }
    return formatValueComparison(vsPlan)
  }

  const getVsPlanColor = () => {
    if (isAllTime && vsPlanSavings) {
      return vsPlanSavings.colorClass
    }
    return vsPlan > 0 ? 'text-primary' : 'text-muted-foreground'
  }

  const getSubtitle = () => {
    if (isAllTime && cumulativeMetrics) {
      return `Avg: ${formatCurrency(cumulativeMetrics.avgMonthlyCost)}/month`
    }
    return `Avg: ${formatCurrency(activeAvgDailyCost)}/day`
  }

  const getDaysDisplay = () => {
    if (isAllTime && cumulativeMetrics) {
      return (
        <>
          {cumulativeMetrics.totalSubscriptionDays} <span className="text-sm font-normal">days</span>
        </>
      )
    }
    return (
      <>
        {activeActiveDays} <span className="text-sm font-normal">active days</span>
      </>
    )
  }

  const getDaysSubtitle = () => {
    if (isAllTime && cumulativeMetrics) {
      return `Since ${cumulativeMetrics.subscriptionStartDate.toLocaleDateString()}`
    }
    return "In selected period"
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
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
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
            Based on {isAllTime ? 'avg monthly' : 'period'} usage
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>API Value Consumed</CardDescription>
                  <CardTitle className="text-3xl">{getApiValueConsumed()}</CardTitle>
                  <CardDescription>{getSubtitle()}</CardDescription>
                </div>
                <CreditCard className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>vs Max ${subscriptionPlan}/month</CardDescription>
                  <CardTitle className={`text-3xl ${getVsPlanColor()}`}>
                    {getVsPlanValue()}
                  </CardTitle>
                  <CardDescription>
                    {vsPlan > 0 ? 'Bonus Value!' : 'Almost there!'}
                  </CardDescription>
                </div>
                <Calculator className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <div className="flex items-center justify-between w-full">
                <div className="space-y-1">
                  <CardDescription>Average Daily Cost</CardDescription>
                  <CardTitle className="text-3xl">{formatCurrency(activeAvgDailyCost)}</CardTitle>
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
                    {isAllTime ? 'Subscription Days' : 'Active Days'}
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {getDaysDisplay()}
                  </CardTitle>
                  <CardDescription>
                    {getDaysSubtitle()}
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
