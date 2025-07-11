/**
 * Billing cycle utilities
 */

export interface BillingCycle {
  startDate: Date
  endDate: Date
  cycleLabel: string
}

/**
 * Get the current billing cycle based on the configured start date
 */
export function getCurrentBillingCycle(billingStartDate: string): BillingCycle {
  // Input validation
  if (!billingStartDate || typeof billingStartDate !== 'string') {
    throw new Error(`Invalid billing start date: ${billingStartDate}. Must be a valid date string.`)
  }

  const subscriptionStartDate = new Date(billingStartDate)
  
  // Validate date parsing
  if (isNaN(subscriptionStartDate.getTime())) {
    throw new Error(`Invalid billing start date format: ${billingStartDate}. Expected format: YYYY-MM-DD`)
  }

  const today = new Date()
  
  // Calculate how many months have passed since subscription started
  const monthsSinceStart = (today.getFullYear() - subscriptionStartDate.getFullYear()) * 12 + 
                          (today.getMonth() - subscriptionStartDate.getMonth())
  
  // Calculate current cycle start date
  const currentCycleStart = new Date(subscriptionStartDate)
  currentCycleStart.setMonth(subscriptionStartDate.getMonth() + monthsSinceStart)
  
  // If we haven't reached the billing day this month, go back one month
  if (today.getDate() < subscriptionStartDate.getDate()) {
    currentCycleStart.setMonth(currentCycleStart.getMonth() - 1)
  }
  
  // Calculate cycle end date (day before next cycle starts)
  const nextCycleStart = new Date(currentCycleStart)
  nextCycleStart.setMonth(currentCycleStart.getMonth() + 1)
  
  const endDate = new Date(nextCycleStart)
  endDate.setDate(endDate.getDate() - 1)
  endDate.setHours(23, 59, 59, 999)

  // Generate cycle label
  const cycleLabel = `${currentCycleStart.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric' 
  })} - ${endDate.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  })}`

  return {
    startDate: currentCycleStart,
    endDate,
    cycleLabel
  }
}

/**
 * Get days remaining in current billing cycle
 */
export function getDaysRemainingInBillingCycle(billingStartDate: string): number {
  const cycle = getCurrentBillingCycle(billingStartDate)
  const today = new Date()
  const diffTime = cycle.endDate.getTime() - today.getTime()
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)))
}

/**
 * Get the previous billing cycle based on the configured start date
 */
export function getPreviousBillingCycle(billingStartDate: string): BillingCycle {
  const currentCycle = getCurrentBillingCycle(billingStartDate)
  
  // Go back one month from current cycle start
  const startDate = new Date(currentCycle.startDate)
  startDate.setMonth(startDate.getMonth() - 1)
  
  // End date is the day before current cycle starts
  const endDate = new Date(currentCycle.startDate)
  endDate.setDate(endDate.getDate() - 1)
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