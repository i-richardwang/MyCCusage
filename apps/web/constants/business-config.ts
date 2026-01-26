/**
 * Business configuration constants
 * Centralized configuration for user tiers, pricing, and query limits
 */

/**
 * User tier thresholds based on monthly cost (USD)
 */
export const USER_TIER_THRESHOLDS = {
  HEAVY: 200,
  POWER: 100,
  REGULAR: 50
} as const

/**
 * Subscription plan pricing (USD per month)
 */
export const PLAN_PRICING = {
  MAX_100: 100,
  MAX_200: 200
} as const

/**
 * Subscription plan type
 */
export type SubscriptionPlan = 100 | 200

/**
 * Get user's subscription plan from environment variable
 * Defaults to 200 if not set or invalid
 */
export function getSubscriptionPlan(): SubscriptionPlan {
  const planStr = process.env.NEXT_PUBLIC_SUBSCRIPTION_PLAN
  const plan = planStr ? parseInt(planStr, 10) : 200
  return plan === 100 ? 100 : 200
}

/**
 * Get plan pricing based on subscription plan
 */
export function getPlanPricing(plan: SubscriptionPlan): number {
  return plan === 100 ? PLAN_PRICING.MAX_100 : PLAN_PRICING.MAX_200
}

/**
 * Query limits for database operations
 */
export const QUERY_LIMITS = {
  DAILY_RECORDS: 30,
  DEVICE_RECORDS: 300
} as const

/**
 * User tier type
 */
export type UserTier = 'Heavy User' | 'Power User' | 'Regular User' | 'Light User'

/**
 * User status interface
 */
export interface UserStatus {
  tier: UserTier
  title: string
  subtitle: string
  color: string
}

/**
 * User status configurations by tier
 */
export const USER_STATUS_CONFIG: Record<UserTier, UserStatus> = {
  'Heavy User': {
    tier: 'Heavy User',
    title: 'Heavy User',
    subtitle: 'Exceptional value with intensive usage - maximizing your investment!',
    color: 'text-primary'
  },
  'Power User': {
    tier: 'Power User',
    title: 'Power User',
    subtitle: 'Strong value with consistent usage patterns.',
    color: 'text-primary'
  },
  'Regular User': {
    tier: 'Regular User',
    title: 'Regular User',
    subtitle: 'Building steady value through regular usage.',
    color: 'text-primary'
  },
  'Light User': {
    tier: 'Light User',
    title: 'Light User',
    subtitle: 'Opportunity to explore more features for greater value.',
    color: 'text-muted-foreground'
  }
} as const

/**
 * Get user status based on cost
 */
export function getUserStatusByAmount(cost: number): UserStatus {
  if (cost >= USER_TIER_THRESHOLDS.HEAVY) {
    return USER_STATUS_CONFIG['Heavy User']
  }
  if (cost >= USER_TIER_THRESHOLDS.POWER) {
    return USER_STATUS_CONFIG['Power User']
  }
  if (cost >= USER_TIER_THRESHOLDS.REGULAR) {
    return USER_STATUS_CONFIG['Regular User']
  }
  return USER_STATUS_CONFIG['Light User']
}
