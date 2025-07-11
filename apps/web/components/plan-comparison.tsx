"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

interface PlanComparisonProps {
  currentCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
  activeDays?: number
}

export function PlanComparison({ currentCycleCost, billingCycleLabel, daysRemaining, activeDays }: PlanComparisonProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  // Calculate value gained from subscription plans
  const max100Value = currentCycleCost - 100  // How much value gained vs $100 plan
  const max200Value = currentCycleCost - 200  // How much value gained vs $200 plan
  
  // Calculate ROI percentages
  const max100ROI = ((currentCycleCost / 100) * 100)
  const max200ROI = ((currentCycleCost / 200) * 100)
  
  // Determine optimal plan suggestion
  const suggestedPlan = currentCycleCost <= 100 
    ? 'Perfect for $100 Plan' 
    : currentCycleCost <= 200 
      ? 'Perfect for $200 Plan' 
      : 'Heavy User - Great Value!'

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>💰 Subscription Value Analysis</CardTitle>
          <CardDescription>
            API value consumed this cycle {billingCycleLabel ? `(${billingCycleLabel})` : ''} vs your subscription investment
            {activeDays !== undefined && ` • ${activeDays} active days of value`}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Current API Value */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>API Value Consumed</CardDescription>
              <CardTitle className="text-3xl">{formatCurrency(currentCycleCost)}</CardTitle>
              <CardDescription>
                {suggestedPlan}
                {daysRemaining !== undefined && ` • ${daysRemaining} days remaining`}
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* Max $100 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $100/month Plan</CardDescription>
              <CardTitle className={`text-3xl ${max100Value > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                {max100Value > 0 ? `+${formatCurrency(Math.abs(max100Value))}` : `-${formatCurrency(Math.abs(max100Value))}`}
              </CardTitle>
              <CardDescription>
                {max100Value > 0 
                  ? `Extra value gained vs $100 subscription` 
                  : `Remaining to break even with $100 plan`}
              </CardDescription>
            </CardHeader>
          </Card>
          
          {/* Max $200 Plan */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>vs Max $200/month Plan</CardDescription>
              <CardTitle className={`text-3xl ${max200Value > 0 ? 'text-green-600' : 'text-blue-600'}`}>
                {max200Value > 0 ? `+${formatCurrency(Math.abs(max200Value))}` : `-${formatCurrency(Math.abs(max200Value))}`}
              </CardTitle>
              <CardDescription>
                {max200Value > 0 
                  ? `Extra value gained vs $200 subscription` 
                  : `Remaining to break even with $200 plan`}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}