/**
 * Cumulative metrics utilities for ROI calculations
 */

export interface CumulativeMetrics {
  // Cumulative statistics
  totalCostAllTime: number          // Total cumulative cost
  totalTokensAllTime: number        // Total cumulative tokens
  totalActiveDays: number           // Total active days (days with records)
  totalSubscriptionDays: number     // Total subscription days (days from start to now)
  
  // Time calculations
  subscriptionStartDate: Date       // Subscription start date (based on config or earliest record)
  totalMonths: number               // Total subscription months
  
  // Derived metrics
  avgMonthlyCost: number            // Average monthly cost
  totalSavedVs100: number           // Extra value gained: API value received - $100 plan cost
  totalSavedVs200: number           // Extra value gained: API value received - $200 plan cost
}

export interface CumulativeDataInput {
  totalCost: number
  totalTokens: number
  activeDays: number
  earliestDate: string | null
  latestDate: string | null
}

/**
 * Calculate cumulative metrics for ROI dashboard
 */
export function calculateCumulativeMetrics(
  cumulativeData: CumulativeDataInput,
  billingStartDate: string
): CumulativeMetrics {
  const { totalCost, totalTokens, activeDays } = cumulativeData
  
  // Determine subscription start date: use configured billing start date as subscription start
  const subscriptionStartDate = new Date(billingStartDate)
  
  // Validate subscription start date
  if (isNaN(subscriptionStartDate.getTime())) {
    throw new Error(`Invalid subscription start date: ${billingStartDate}`)
  }
  
  const today = new Date()
  
  // Calculate total months: months from subscription start to now
  const yearDiff = today.getFullYear() - subscriptionStartDate.getFullYear()
  const monthDiff = today.getMonth() - subscriptionStartDate.getMonth()
  const dayDiff = today.getDate() - subscriptionStartDate.getDate()
  
  // Precise month calculation (including partial months)
  let totalMonths = yearDiff * 12 + monthDiff
  if (dayDiff >= 0) {
    totalMonths += 1 // Include current month
  }
  
  // Ensure at least 1 month to avoid division by zero
  totalMonths = Math.max(totalMonths, 1)
  
  // Calculate total days from subscription start to now
  const timeDiff = today.getTime() - subscriptionStartDate.getTime()
  const totalSubscriptionDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1 // +1 to include start date
  
  // Calculate derived metrics
  const avgMonthlyCost = totalCost / totalMonths
  
  // Calculate ROI: actual API value received - what you would pay for subscription (value gained)
  const totalSavedVs100 = totalCost - (100 * totalMonths)
  const totalSavedVs200 = totalCost - (200 * totalMonths)
  
  return {
    totalCostAllTime: totalCost,
    totalTokensAllTime: totalTokens,
    totalActiveDays: activeDays,
    totalSubscriptionDays,
    subscriptionStartDate,
    totalMonths,
    avgMonthlyCost,
    totalSavedVs100,
    totalSavedVs200
  }
}

/**
 * Get user status based on average monthly cost (same logic as current cycle)
 */
export function getCumulativeUserStatus(avgMonthlyCost: number) {
  if (avgMonthlyCost >= 200) {
    return { 
      title: "Heavy User", 
      subtitle: "Exceptional long-term ROI with consistently high usage.", 
      color: "text-primary"
    }
  } else if (avgMonthlyCost >= 100) {
    return { 
      title: "Power User", 
      subtitle: "Strong long-term value with reliable usage patterns.", 
      color: "text-primary"
    }
  } else if (avgMonthlyCost >= 50) {
    return { 
      title: "Regular User", 
      subtitle: "Building consistent long-term value over time.", 
      color: "text-primary"
    }
  } else {
    return { 
      title: "Light User", 
      subtitle: "Opportunity to increase usage for better value.", 
      color: "text-muted-foreground"
    }
  }
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * Format savings display with proper sign and color class
 */
export function formatSavings(savings: number): { 
  text: string; 
  colorClass: string; 
  description: string 
} {
  const isPositive = savings > 0
  return {
    text: isPositive 
      ? `+${formatCurrency(Math.abs(savings))}` 
      : `-${formatCurrency(Math.abs(savings))}`,
    colorClass: isPositive ? 'text-primary' : 'text-destructive',
    description: isPositive ? 'Total Earned!' : 'Still Behind'
  }
}