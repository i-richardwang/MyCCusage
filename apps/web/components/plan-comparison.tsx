"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { 
  calculateCumulativeMetrics, 
  getCumulativeUserStatus,
  formatCurrency, 
  formatSavings,
  type CumulativeDataInput 
} from "@/lib/cumulative-metrics"
import { Badge } from "@workspace/ui/components/badge"
import { Crown, Zap, Users, Lightbulb, CreditCard, Calculator, Calendar } from "lucide-react"

type ROIMode = 'current' | 'cumulative'

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
  const [roiMode, setROIMode] = useState<ROIMode>('current')
  
  // Calculate cumulative metrics if data is available
  const cumulativeMetrics = cumulativeData && billingStartDate 
    ? calculateCumulativeMetrics(cumulativeData, billingStartDate)
    : null

  // Current cycle calculations
  const max100Value = currentCycleCost - 100
  const max200Value = currentCycleCost - 200
  const monthlyChange = currentCycleCost - previousCycleCost
  const monthlyChangePercent = previousCycleCost > 0 ? ((monthlyChange / previousCycleCost) * 100) : 0
  
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
  const isCurrentMode = roiMode === 'current'
  const userStatus = isCurrentMode ? getCurrentUserStatus() : getCumulativeUserStatus(cumulativeMetrics?.avgMonthlyCost || 0)
  
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

  const statusColors = {
    "Heavy User": "border-primary text-primary",
    "Power User": "border-primary text-primary", 
    "Regular User": "border-primary text-primary",
    "Light User": "border-muted-foreground text-muted-foreground"
  } as const

  const IconComponent = statusIcons[userStatus.title as keyof typeof statusIcons] || Users
  const badgeColor = statusColors[userStatus.title as keyof typeof statusColors] || statusColors["Light User"]

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Subscription ROI Dashboard</CardTitle>
          <CardDescription>
            Track your subscription returns - how much value you&apos;re harvesting!
          </CardDescription>
        </div>
        <Select value={roiMode} onValueChange={(value: ROIMode) => setROIMode(value)}>
          <SelectTrigger 
            className="hidden w-[160px] rounded-lg sm:ml-auto sm:flex"
            aria-label="Select ROI view mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            <SelectItem value="current" className="rounded-lg">
              Current Cycle
            </SelectItem>
            <SelectItem value="cumulative" className="rounded-lg">
              Since Start
            </SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        {/* User Status Badge - Full Width */}
        <div className="mb-6 w-full">
          <div className="p-4 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/20">
            <div className="flex items-center flex-wrap gap-4">
              <div className="p-3 rounded-full bg-background">
                <IconComponent className={`w-8 h-8 ${userStatus.color}`} />
              </div>
              <Badge 
                variant="outline" 
                className={`text-lg sm:text-xl font-bold px-3 sm:px-4 py-1 sm:py-2 ${badgeColor} whitespace-nowrap bg-transparent`}
              >
                {userStatus.title}
              </Badge>
              <div className={`text-lg sm:text-xl font-bold ${userStatus.color}`}>
                {userStatus.subtitle}
              </div>
            </div>
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
                    {isCurrentMode 
                      ? formatCurrency(currentCycleCost)
                      : formatCurrency(cumulativeMetrics?.totalCostAllTime || 0)
                    }
                  </CardTitle>
                  <CardDescription>
                    {isCurrentMode ? (
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
                    isCurrentMode 
                      ? (max100Value > 0 ? 'text-primary' : 'text-muted-foreground')
                      : vs100Savings?.colorClass || 'text-muted-foreground'
                  }`}>
                    {isCurrentMode ? (
                      max100Value > 0 ? `+${formatCurrency(Math.abs(max100Value))}` : `-${formatCurrency(Math.abs(max100Value))}`
                    ) : (
                      vs100Savings?.text || '$0.00'
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isCurrentMode ? (
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
                    isCurrentMode 
                      ? (max200Value > 0 ? 'text-primary' : 'text-muted-foreground')
                      : vs200Savings?.colorClass || 'text-muted-foreground'
                  }`}>
                    {isCurrentMode ? (
                      max200Value > 0 ? `+${formatCurrency(Math.abs(max200Value))}` : `-${formatCurrency(Math.abs(max200Value))}`
                    ) : (
                      vs200Savings?.text || '$0.00'
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isCurrentMode ? (
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
                    {isCurrentMode ? 'Billing Cycle' : 'Subscription Days'}
                  </CardDescription>
                  <CardTitle className="text-3xl">
                    {isCurrentMode ? (
                      <>{daysRemaining !== undefined ? daysRemaining : 0} <span className="text-sm font-normal">days remaining</span></>
                    ) : (
                      <>{cumulativeMetrics?.totalSubscriptionDays || 0} <span className="text-sm font-normal">days</span></>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {isCurrentMode ? (
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