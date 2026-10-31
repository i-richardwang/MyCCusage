import { describe, expect, it } from "vitest";
import { createCalendar, isTimeZone } from "../src/calendar";

const iso = (range: [Date, Date]) => range.map((d) => d.toISOString());

describe("createCalendar", () => {
  it("buckets instants by the calendar's zone, not the process zone", () => {
    const instant = new Date("2026-10-19T16:30:00Z");
    expect(createCalendar("Asia/Shanghai").dayOf(instant)).toBe("2026-10-20");
    expect(createCalendar("America/New_York").dayOf(instant)).toBe(
      "2026-10-19",
    );
  });

  it("returns the [start, end) instants of a day", () => {
    expect(iso(createCalendar("Asia/Shanghai").rangeOf("2026-10-20"))).toEqual([
      "2026-10-19T16:00:00.000Z",
      "2026-10-20T16:00:00.000Z",
    ]);
    // Offsets that are not whole hours
    expect(iso(createCalendar("Asia/Kathmandu").rangeOf("2026-10-20"))).toEqual(
      ["2026-10-19T18:15:00.000Z", "2026-10-20T18:15:00.000Z"],
    );
  });

  it("handles 23- and 25-hour DST days", () => {
    const newYork = createCalendar("America/New_York");
    expect(iso(newYork.rangeOf("2026-03-08"))).toEqual([
      "2026-03-08T05:00:00.000Z",
      "2026-03-09T04:00:00.000Z",
    ]);
    expect(iso(newYork.rangeOf("2026-11-01"))).toEqual([
      "2026-11-01T04:00:00.000Z",
      "2026-11-02T05:00:00.000Z",
    ]);
  });

  it("starts a day when DST skips its midnight", () => {
    // Cuba springs forward at 00:00, so 2026-03-08 begins at 01:00 CDT
    const havana = createCalendar("America/Havana");
    const [start] = havana.rangeOf("2026-03-08");
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(havana.dayOf(new Date(start.getTime() - 1))).toBe("2026-03-07");
  });

  it("agrees with itself: every instant of a range falls on its day", () => {
    const calendar = createCalendar("Europe/London");
    for (const day of ["2026-03-29", "2026-10-25", "2026-06-15"]) {
      const [start, end] = calendar.rangeOf(day);
      expect(calendar.dayOf(start)).toBe(day);
      expect(calendar.dayOf(new Date(end.getTime() - 1))).toBe(day);
      expect(calendar.dayOf(end)).not.toBe(day);
    }
  });

  it("rejects unknown zones and invalid days", () => {
    expect(isTimeZone("Asia/Shanghai")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(() => createCalendar("Mars/Olympus")).toThrow("Unknown time zone");
    const calendar = createCalendar("UTC");
    expect(() => calendar.rangeOf("2026-02-30")).toThrow("Invalid day");
    expect(() => calendar.rangeOf("20261020")).toThrow("Invalid day");
  });

  it("starts hours on the account's clocks", () => {
    const hour = (zone: string, instant: string) =>
      createCalendar(zone).hourOf(new Date(instant)).toISOString();
    expect(hour("Asia/Shanghai", "2026-10-20T16:59:59.999Z")).toBe(
      "2026-10-20T16:00:00.000Z",
    );
    expect(hour("Asia/Kolkata", "2026-10-20T16:15:00Z")).toBe(
      "2026-10-20T15:30:00.000Z",
    );
    expect(hour("Asia/Kathmandu", "2026-10-20T16:15:00Z")).toBe(
      "2026-10-20T16:15:00.000Z",
    );
    // The repeated hour when New York leaves daylight saving time
    expect(hour("America/New_York", "2026-11-01T05:30:00Z")).toBe(
      "2026-11-01T05:00:00.000Z",
    );
    expect(hour("America/New_York", "2026-11-01T06:30:00Z")).toBe(
      "2026-11-01T06:00:00.000Z",
    );
  });
});
