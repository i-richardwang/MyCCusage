/**
 * Cumulative metrics utilities for ROI calculations
 */

import {
  USER_TIER_THRESHOLDS,
  PLAN_PRICING,
  getUserStatusByAmount,
  getSubscriptionPlan,
  getPlanPricing,
  type UserStatus,
  type SubscriptionPlan
} from '@/constants/business-config'
import type { CumulativeData } from '@/types/api-types'

export interface CumulativeMetrics {
  totalCostAllTime: number
  totalTokensAllTime: number
  totalActiveDays: number
  totalSubscriptionDays: number
  subscriptionStartDate: Date
  totalMonths: number
  avgMonthlyCost: number
  totalSavedVsPlan: number
  subscriptionPlan: SubscriptionPlan
}

/**
 * Calculate cumulative metrics for ROI dashboard
 */
export function calculateCumulativeMetrics(
  cumulativeData: CumulativeData,
  billingStartDate: string
): CumulativeMetrics {
  const { totalCost, totalTokens, activeDays } = cumulativeData

  const subscriptionStartDate = new Date(billingStartDate)

  if (isNaN(subscriptionStartDate.getTime())) {
    throw new Error(`Invalid subscription start date: ${billingStartDate}`)
  }

  const today = new Date()

  // Calculate total months
  const yearDiff = today.getFullYear() - subscriptionStartDate.getFullYear()
  const monthDiff = today.getMonth() - subscriptionStartDate.getMonth()
  const dayDiff = today.getDate() - subscriptionStartDate.getDate()

  let totalMonths = yearDiff * 12 + monthDiff
  if (dayDiff >= 0) {
    totalMonths += 1
  }
  totalMonths = Math.max(totalMonths, 1)

  // Calculate total subscription days
  const timeDiff = today.getTime() - subscriptionStartDate.getTime()
  const totalSubscriptionDays = Math.floor(timeDiff / (1000 * 60 * 60 * 24)) + 1

  // Calculate derived metrics
  const subscriptionPlan = getSubscriptionPlan()
  const planPrice = getPlanPricing(subscriptionPlan)
  const avgMonthlyCost = totalCost / totalMonths
  const totalSavedVsPlan = totalCost - (planPrice * totalMonths)

  return {
    totalCostAllTime: totalCost,
    totalTokensAllTime: totalTokens,
    totalActiveDays: activeDays,
    totalSubscriptionDays,
    subscriptionStartDate,
    totalMonths,
    avgMonthlyCost,
    totalSavedVsPlan,
    subscriptionPlan
  }
}

/**
 * Get user status based on average monthly cost
 */
export function getCumulativeUserStatus(avgMonthlyCost: number): UserStatus {
  return getUserStatusByAmount(avgMonthlyCost)
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

// Re-export for convenience
export { USER_TIER_THRESHOLDS, PLAN_PRICING, getUserStatusByAmount, getSubscriptionPlan, getPlanPricing }
export type { CumulativeData, SubscriptionPlan }
