/**
 * Parse a "YYYY-MM-DD" date string as a local-timezone Date.
 * Unlike `new Date("YYYY-MM-DD")` which parses as UTC midnight,
 * this function creates a Date at local midnight, avoiding
 * day-shift issues when displaying with toLocaleDateString().
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

/**
 * Format a "YYYY-MM-DD" string for chart display (e.g., "Jan 15").
 * Handles timezone correctly by parsing as local date.
 */
export function formatChartDate(dateStr: string): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
