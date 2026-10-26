// Calendar day in the collector's system timezone, matching ccusage daily
// semantics (ccusage groups by the system timezone unless --timezone is
// given). toISOString() would group by UTC and misattribute late-night usage
// to the previous day.
export function toLocalDate(timestamp: Date): string {
  return (
    `${timestamp.getFullYear()}-` +
    `${String(timestamp.getMonth() + 1).padStart(2, "0")}-` +
    `${String(timestamp.getDate()).padStart(2, "0")}`
  );
}
