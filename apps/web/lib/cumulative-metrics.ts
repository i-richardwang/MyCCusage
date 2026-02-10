/**
 * Subscription period and ROI calculation utilities
 */

import {
  USER_TIER_THRESHOLDS,
  PLAN_PRICING,
  getUserStatusByAmount,
  getSubscriptionPlan,
  getPlanPricing,
  type SubscriptionPlan
} from '@/constants/business-config'

export interface SubscriptionPeriod {
  startDate: Date
  totalDays: number
  totalMonths: number
}

/**
 * Calculate subscription period metadata from billing start date
 */
export function getSubscriptionPeriod(billingStartDate: string): SubscriptionPeriod {
  const startDate = new Date(billingStartDate)

  if (isNaN(startDate.getTime())) {
    throw new Error(`Invalid subscription start date: ${billingStartDate}`)
  }

  const today = new Date()

  // Calculate total months
  const yearDiff = today.getFullYear() - startDate.getFullYear()
  const monthDiff = today.getMonth() - startDate.getMonth()
  const dayDiff = today.getDate() - startDate.getDate()

  let totalMonths = yearDiff * 12 + monthDiff
  if (dayDiff >= 0) {
    totalMonths += 1
  }
  totalMonths = Math.max(totalMonths, 1)

  // Calculate total subscription days
  const timeDiff = today.getTime() - startDate.getTime()
  const totalDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1

  return { startDate, totalDays, totalMonths }
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
  text: string
  colorClass: string
} {
  const isPositive = savings > 0
  return {
    text: isPositive
      ? `+${formatCurrency(Math.abs(savings))}`
      : `-${formatCurrency(Math.abs(savings))}`,
    colorClass: isPositive ? 'text-primary' : 'text-destructive'
  }
}

// Re-export for convenience
export { USER_TIER_THRESHOLDS, PLAN_PRICING, getUserStatusByAmount, getSubscriptionPlan, getPlanPricing }
export type { SubscriptionPlan }
