"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"

interface PlanComparisonProps {
  currentCycleCost: number
  billingCycleLabel?: string
  daysRemaining?: number
}

export function PlanComparison({ currentCycleCost, billingCycleLabel, daysRemaining }: PlanComparisonProps) {
  const formatCurrency = (amount: number) => {
    return `$${amount.toFixed(2)}`
  }

  // Calculate comparison with quota plans
  const max100Savings = Math.max(0, 100 - currentCycleCost)
  const max200Savings = Math.max(0, 200 - currentCycleCost)
  
  // Determine current plan status
  const actualPlan = currentCycleCost <= 100 
    ? 'Max $100' 
    : currentCycleCost <= 200 
      ? 'Max $200' 
      : 'Over Limit'

  return (
    <Card className="pt-0">
      <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
        <div className="grid flex-1 gap-1">
          <CardTitle>Plan Comparison</CardTitle>
          <CardDescription>
            Current billing cycle {billingCycleLabel ? `(${billingCycleLabel})` : ''} vs Max $100/month and Max $200/month plans
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-2 py-4 sm:px-6 sm:py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Current Total */}
          <div className="space-y-2 p-4 rounded border bg-card">
            <p className="text-sm font-medium text-muted-foreground">Current Billing Cycle</p>
            <p className="text-2xl font-bold">{formatCurrency(currentCycleCost)}</p>
            <p className="text-xs text-muted-foreground">
              {actualPlan}
              {daysRemaining !== undefined && ` • ${daysRemaining} days left`}
            </p>
          </div>
          
          {/* Comparison with Max $100 */}
          <div className="space-y-2 p-4 rounded border bg-card">
            <p className="text-sm font-medium text-muted-foreground">vs Max $100 Plan</p>
            <p className={`text-2xl font-bold ${max100Savings > 0 ? 'text-primary' : 'text-destructive'}`}>
              {max100Savings > 0 ? `+${formatCurrency(max100Savings)}` : `-${formatCurrency(currentCycleCost - 100)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {max100Savings > 0 ? 'Under Budget' : 'Over Budget'}
            </p>
          </div>
          
          {/* Comparison with Max $200 */}
          <div className="space-y-2 p-4 rounded border bg-card">
            <p className="text-sm font-medium text-muted-foreground">vs Max $200 Plan</p>
            <p className={`text-2xl font-bold ${max200Savings > 0 ? 'text-primary' : 'text-destructive'}`}>
              {max200Savings > 0 ? `+${formatCurrency(max200Savings)}` : `-${formatCurrency(currentCycleCost - 200)}`}
            </p>
            <p className="text-xs text-muted-foreground">
              {max200Savings > 0 ? 'Under Budget' : 'Over Budget'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}