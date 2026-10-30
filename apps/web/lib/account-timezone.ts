/**
 * The account calendar: the IANA time zone every collector buckets daily
 * usage in, and the zone the dashboard's "today" is in. One zone for the
 * whole account keeps a date meaning the same day on every device and in
 * every browser.
 */
const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function getAccountTimeZone(): string {
  const timeZone = process.env.USAGE_TIMEZONE?.trim() || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(
      `USAGE_TIMEZONE is not a valid IANA time zone: ${timeZone}`,
    );
  }
  return timeZone;
}
