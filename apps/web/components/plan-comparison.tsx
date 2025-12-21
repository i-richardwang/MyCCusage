"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  calculateCumulativeMetrics,
  getCumulativeUserStatus,
  formatCurrency,
  formatSavings,
  type CumulativeDataInput
} from "@/lib/cumulative-metrics"
import { Crown, Zap, Users, Lightbulb, CreditCard, Calculator, Calendar } from "lucide-react"

type ROIMode = 'last30days' | 'current' | 'cumulative'

interface PlanComparisonProps {
  currentCycleCost: number
  previousCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
  cumulativeData?: CumulativeDataInput
  billingStartDate?: string
  last30DaysData?: {
    totalCost: number
    totalTokens: number
    activeDays: number
    avgDailyCost: number
  }
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

  // Current cycle calculations
  const max100Value = currentCycleCost - 100
  const max200Value = currentCycleCost - 200
  const monthlyChange = currentCycleCost - previousCycleCost
  const monthlyChangePercent = previousCycleCost > 0 ? ((monthlyChange / previousCycleCost) * 100) : 0

  // Last 30 days calculations
  const last30DaysCost = last30DaysData?.totalCost || 0
  const last30DaysMax100Value = last30DaysCost - 100
  const last30DaysMax200Value = last30DaysCost - 200
  const last30DaysActiveDays = last30DaysData?.activeDays || 0
  
  const getCurrentUserStatus = () => {
    // Use last 30 days cost for more accurate user classification
    const last30DaysCost = last30DaysData?.totalCost || 0
    
    if (last30DaysCost >= 200) {
      return { 
        title: "Heavy User", 
        subtitle: "Exceptional value with intensive usage - maximizing your investment!", 
        color: "text-primary"
      }
    } else if (last30DaysCost >= 100) {
      return { 
        title: "Power User", 
        subtitle: "Strong value with consistent usage patterns.", 
        color: "text-primary"
      }
    } else if (last30DaysCost >= 50) {
      return { 
        title: "Regular User", 
        subtitle: "Building steady value through regular usage.", 
        color: "text-primary"
      }
    } else {
      return { 
        title: "Light User", 
        subtitle: "Opportunity to explore more features for greater value.", 
        color: "text-muted-foreground"
      }
    }
  }
  
  // Determine which data to display based on mode
  const isLast30DaysMode = roiMode === 'last30days'
  const isCurrentMode = roiMode === 'current'
  const isCumulativeMode = roiMode === 'cumulative'

  // User status: last30days and current both use last 30 days data, cumulative uses avg monthly
  const userStatus = isCumulativeMode
    ? getCumulativeUserStatus(cumulativeMetrics?.avgMonthlyCost || 0)
    : getCurrentUserStatus()
  
  // Format savings for cumulative mode
  const vs100Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs100) : null
  const vs200Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs200) : null

  // Icon mapping for user status
  const statusIcons = {
    "Heavy User": Crown,
    "Power User": Zap,
    "Regular User": Users,
    "Light User": Lightbulb
  } as const

  const IconComponent = statusIcons[userStatus.title as keyof typeof statusIcons] || Users

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
        {/* User Status - Compact inline design */}
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className={`p-2 ${userStatus.title === 'Light User' ? 'bg-muted' : 'bg-primary/10'}`}>
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
                  <CardTitle className="text-3xl">
                    {isLast30DaysMode
                      ? formatCurrency(last30DaysCost)
                      : isCurrentMode
                        ? formatCurrency(currentCycleCost)
                        : formatCurrency(cumulativeMetrics?.totalCostAllTime || 0)
                    }
                  </CardTitle>
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
                  <CardDescription>vs Max $100/month</CardDescription>
                  <CardTitle className={`text-3xl ${
                    isLast30DaysMode
                      ? (last30DaysMax100Value > 0 ? 'text-primary' : 'text-muted-foreground')
                      : isCurrentMode
                        ? (max100Value > 0 ? 'text-primary' : 'text-muted-foreground')
                        : vs100Savings?.colorClass || 'text-muted-foreground'
                  }`}>
                    {isLast30DaysMode ? (
                      last30DaysMax100Value > 0 ? `+${formatCurrency(Math.abs(last30DaysMax100Value))}` : `-${formatCurrency(Math.abs(last30DaysMax100Value))}`
                    ) : isCurrentMode ? (
                      max100Value > 0 ? `+${formatCurrency(Math.abs(max100Value))}` : `-${formatCurrency(Math.abs(max100Value))}`
                    ) : (
                      vs100Savings?.text || '$0.00'
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      last30DaysMax100Value > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : isCurrentMode ? (
                      max100Value > 0 ? 'Bonus Value!' : 'Almost there!'
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
                  <CardDescription>vs Max $200/month</CardDescription>
                  <CardTitle className={`text-3xl ${
                    isLast30DaysMode
                      ? (last30DaysMax200Value > 0 ? 'text-primary' : 'text-muted-foreground')
                      : isCurrentMode
                        ? (max200Value > 0 ? 'text-primary' : 'text-muted-foreground')
                        : vs200Savings?.colorClass || 'text-muted-foreground'
                  }`}>
                    {isLast30DaysMode ? (
                      last30DaysMax200Value > 0 ? `+${formatCurrency(Math.abs(last30DaysMax200Value))}` : `-${formatCurrency(Math.abs(last30DaysMax200Value))}`
                    ) : isCurrentMode ? (
                      max200Value > 0 ? `+${formatCurrency(Math.abs(max200Value))}` : `-${formatCurrency(Math.abs(max200Value))}`
                    ) : (
                      vs200Savings?.text || '$0.00'
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isLast30DaysMode ? (
                      last30DaysMax200Value > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : isCurrentMode ? (
                      max200Value > 0 ? 'Bonus Value!' : 'Almost there!'
                    ) : (
                      vs200Savings?.description || 'No data'
                    )}
                  </CardDescription>
                </div>
                <Calculator className="h-6 w-6 text-muted-foreground" />
              </div>
            </CardHeader>
          </Card>

          {/* Days Remaining / Subscription Days */}
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
                      <>{daysRemaining !== undefined ? daysRemaining : 0} <span className="text-sm font-normal">days remaining</span></>
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