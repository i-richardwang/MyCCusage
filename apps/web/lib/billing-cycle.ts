/**
 * Billing cycle utilities
 */

export interface BillingCycle {
  startDate: Date
  endDate: Date
  cycleLabel: string
}

/**
 * Get the current billing cycle based on the configured start day
 */
export function getCurrentBillingCycle(billingStartDay: number = 1): BillingCycle {
  const today = new Date()
  const currentMonth = today.getMonth()
  const currentYear = today.getFullYear()
  const currentDay = today.getDate()

  let cycleStartMonth = currentMonth
  let cycleStartYear = currentYear

  // If we haven't reached the billing start day this month, 
  // the current cycle started last month
  if (currentDay < billingStartDay) {
    cycleStartMonth = currentMonth - 1
    if (cycleStartMonth < 0) {
      cycleStartMonth = 11
      cycleStartYear = currentYear - 1
    }
  }

  // Calculate cycle start date
  const startDate = new Date(cycleStartYear, cycleStartMonth, billingStartDay)
  
  // Calculate cycle end date (day before next cycle starts)
  const nextCycleMonth = cycleStartMonth + 1
  const nextCycleYear = nextCycleMonth > 11 ? cycleStartYear + 1 : cycleStartYear
  const adjustedNextMonth = nextCycleMonth > 11 ? 0 : nextCycleMonth
  
  const endDate = new Date(nextCycleYear, adjustedNextMonth, billingStartDay - 1)
  endDate.setHours(23, 59, 59, 999)

  // Generate cycle label
  const cycleLabel = `${startDate.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  })} - ${endDate.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  })}`

  return {
    startDate,
    endDate,
    cycleLabel
  }
}

/**
 * Get days remaining in current billing cycle
 */
export function getDaysRemainingInBillingCycle(billingStartDay: number = 1): number {
  const cycle = getCurrentBillingCycle(billingStartDay)
  const today = new Date()
  const diffTime = cycle.endDate.getTime() - today.getTime()
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
}