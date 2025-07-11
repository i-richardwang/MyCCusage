"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

interface PlanComparisonProps {
  currentCycleCost: number
  previousCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
}

export function PlanComparison({ currentCycleCost, previousCycleCost, billingCycleLabel, daysRemaining }: PlanComparisonProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  // Calculate value gained from subscription plans
  const max100Value = currentCycleCost - 100  // How much value gained vs $100 plan
  const max200Value = currentCycleCost - 200  // How much value gained vs $200 plan
  
  // Calculate month-over-month comparison
  const monthlyChange = currentCycleCost - previousCycleCost
  const monthlyChangePercent = previousCycleCost > 0 ? ((monthlyChange / previousCycleCost) * 100) : 0
  
  // Dynamic user status based on usage
  const getUserStatus = () => {
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
  
  const userStatus = getUserStatus()

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
          
          {/* Current API Value */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>API Value Consumed</CardDescription>
              <CardTitle className="text-3xl">{formatCurrency(currentCycleCost)}</CardTitle>
              <CardDescription>
                vs last month: 
                <span className={`ml-1 ${monthlyChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {monthlyChangePercent >= 0 ? '+' : ''}{monthlyChangePercent.toFixed(1)}%
                </span>
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* Max $100 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $100/month</CardDescription>
              <CardTitle className={`text-3xl ${max100Value > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                {max100Value > 0 ? `+${formatCurrency(Math.abs(max100Value))}` : `-${formatCurrency(Math.abs(max100Value))}`}
              </CardTitle>
              <CardDescription>
                {max100Value > 0 
                  ? `Bonus Value!` 
                  : `Almost there!`}
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* Max $200 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $200/month</CardDescription>
              <CardTitle className={`text-3xl ${max200Value > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                {max200Value > 0 ? `+${formatCurrency(Math.abs(max200Value))}` : `-${formatCurrency(Math.abs(max200Value))}`}
              </CardTitle>
              <CardDescription>
                {max200Value > 0 
                  ? `Bonus Value!` 
                  : `Almost there!`}
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* Days Remaining */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Billing Cycle</CardDescription>
              <CardTitle className="text-3xl">{daysRemaining !== undefined ? daysRemaining : 0} <span className="text-sm font-normal">days remaining</span></CardTitle>
              <CardDescription>
                {billingCycleLabel}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}