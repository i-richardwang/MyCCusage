/**
 * Subscription period and ROI calculation utilities
 */

import { parseLocalDate } from "@/lib/date-utils";
import { daysBetween, isDay } from "@/lib/day-range";

export interface SubscriptionPeriod {
  startDate: Date;
  totalDays: number;
  totalMonths: number;
}

/**
 * Calculate subscription period metadata from the billing start day through
 * today, both "YYYY-MM-DD" days in the account calendar
 */
export function getSubscriptionPeriod(
  billingStartDate: string,
  today: string,
): SubscriptionPeriod {
  if (!isDay(billingStartDate)) {
    throw new Error(`Invalid subscription start date: ${billingStartDate}`);
  }

  const [startYear, startMonth, startDay] = billingStartDate
    .split("-")
    .map(Number);
  const [year, month, day] = today.split("-").map(Number);

  // Calculate total months
  let totalMonths = (year! - startYear!) * 12 + (month! - startMonth!);
  if (day! >= startDay!) {
    totalMonths += 1;
  }
  totalMonths = Math.max(totalMonths, 1);

  // Calculate total subscription days
  const totalDays = daysBetween(billingStartDate, today) + 1;

  return {
    startDate: parseLocalDate(billingStartDate),
    totalDays,
    totalMonths,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Format savings display with proper sign and color class
 */
export function formatSavings(savings: number): {
  text: string;
  colorClass: string;
} {
  const isPositive = savings > 0;
  return {
    text: isPositive
      ? `+${formatCurrency(Math.abs(savings))}`
      : `-${formatCurrency(Math.abs(savings))}`,
    colorClass: isPositive ? "text-primary" : "text-destructive",
  };
}
