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

type ROIMode = 'current' | 'cumulative'

interface PlanComparisonProps {
  currentCycleCost: number
  previousCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
  cumulativeData?: CumulativeDataInput
  billingStartDate?: string
}

export function PlanComparison({ 
  currentCycleCost, 
  previousCycleCost, 
  billingCycleLabel, 
  daysRemaining,
  cumulativeData,
  billingStartDate 
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
    if (currentCycleCost >= 200) {
      return { title: "Heavy User", subtitle: "Great Value!", color: "text-green-600" }
    } else if (currentCycleCost >= 100) {
      return { title: "Power User", subtitle: "Good Value!", color: "text-blue-600" }
    } else if (currentCycleCost >= 50) {
      return { title: "Regular User", subtitle: "Getting Value", color: "text-yellow-600" }
    } else {
      return { title: "Light User", subtitle: "Room to Grow", color: "text-gray-600" }
    }
  }
  
  // Determine which data to display based on mode
  const isCurrentMode = roiMode === 'current'
  const userStatus = isCurrentMode ? getCurrentUserStatus() : getCumulativeUserStatus(cumulativeMetrics?.avgMonthlyCost || 0)
  
  // Format savings for cumulative mode
  const vs100Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs100) : null
  const vs200Savings = cumulativeMetrics ? formatSavings(cumulativeMetrics.totalSavedVs200) : null

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Subscription ROI Dashboard</CardTitle>
          <CardDescription>
            Track your subscription returns - how much value you&apos;re harvesting!
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">View:</span>
          <Select value={roiMode} onValueChange={(value: ROIMode) => setROIMode(value)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current Cycle</SelectItem>
              <SelectItem value="cumulative">Since Start</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
          {/* User Status */}
          <Card>
            <CardHeader className="pb-2 flex items-center h-full">
              <CardTitle className={`text-2xl ${userStatus.color}`}>
                <div>{userStatus.title}</div>
                <div>{userStatus.subtitle}</div>
              </CardTitle>
            </CardHeader>
          </Card>
          
          {/* API Value Consumed */}
          <Card>
            <CardHeader className="pb-2">
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
            </CardHeader>
          </Card>
          
          {/* vs $100 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $100/month</CardDescription>
              <CardTitle className={`text-3xl ${
                isCurrentMode 
                  ? (max100Value > 0 ? 'text-green-600' : 'text-blue-600')
                  : vs100Savings?.colorClass || 'text-gray-600'
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
            </CardHeader>
          </Card>
          
          {/* vs $200 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $200/month</CardDescription>
              <CardTitle className={`text-3xl ${
                isCurrentMode 
                  ? (max200Value > 0 ? 'text-green-600' : 'text-blue-600')
                  : vs200Savings?.colorClass || 'text-gray-600'
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
            </CardHeader>
          </Card>
          
          {/* Days Remaining / Subscription Days */}
          <Card>
            <CardHeader className="pb-2">
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
            </CardHeader>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}