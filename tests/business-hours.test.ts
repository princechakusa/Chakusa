import { describe, expect, it } from "vitest";
import { resolveBusinessHours } from "../src/lib/businessHours.js";

// Pure, no I/O. All "now" values are explicit UTC instants; the resolver must
// derive local state from the timezone + weekly hours only.

const week = (over: Partial<Record<string, { enabled: boolean; opensAt: string; closesAt: string }>> = {}) => ({
  days: Object.fromEntries(
    ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(d => [
      d,
      over[d] ?? { enabled: d !== "sunday", opensAt: "09:00", closesAt: "17:00" },
    ]),
  ),
});

describe("resolveBusinessHours", () => {
  it("is open inside the weekday window", () => {
    // 2026-06-10 is a Wednesday. 14:00 UTC in UTC tz.
    const s = resolveBusinessHours({ timezone: "UTC", workingHours: week(), now: new Date("2026-06-10T14:00:00Z") });
    expect(s).toMatchObject({ resolved: true, open: true, reason: "open" });
    expect(s.nextOpen).toBeNull();
  });

  it("before opening -> next opening is later today", () => {
    const s = resolveBusinessHours({ timezone: "UTC", workingHours: week(), now: new Date("2026-06-10T07:00:00Z") });
    expect(s).toMatchObject({ open: false, reason: "before_open" });
    expect(s.nextOpen).toMatchObject({ localTime: "09:00", label: "later today at 9:00 AM", localDate: "2026-06-10" });
  });

  it("after closing -> next opening is tomorrow", () => {
    const s = resolveBusinessHours({ timezone: "UTC", workingHours: week(), now: new Date("2026-06-10T19:00:00Z") });
    expect(s).toMatchObject({ open: false, reason: "after_close" });
    expect(s.nextOpen).toMatchObject({ localDate: "2026-06-11", label: "tomorrow at 9:00 AM" });
  });

  it("closed day -> skips to the next enabled day", () => {
    // 2026-06-14 is a Sunday (disabled by default).
    const s = resolveBusinessHours({ timezone: "UTC", workingHours: week(), now: new Date("2026-06-14T12:00:00Z") });
    expect(s).toMatchObject({ open: false, reason: "closed_day" });
    expect(s.nextOpen).toMatchObject({ weekday: "monday", localDate: "2026-06-15" });
  });

  it("multiple consecutive closed days -> next opening jumps the gap", () => {
    const hours = week({ friday: { enabled: false, opensAt: "09:00", closesAt: "17:00" }, saturday: { enabled: false, opensAt: "09:00", closesAt: "17:00" } });
    // Friday 2026-06-12, 12:00
    const s = resolveBusinessHours({ timezone: "UTC", workingHours: hours, now: new Date("2026-06-12T12:00:00Z") });
    expect(s.open).toBe(false);
    expect(s.nextOpen).toMatchObject({ weekday: "monday", localDate: "2026-06-15", label: "Monday at 9:00 AM" });
  });

  it("supports an overnight window (opens 20:00, closes 02:00)", () => {
    const hours = week({
      monday: { enabled: true, opensAt: "20:00", closesAt: "02:00" },
      tuesday: { enabled: true, opensAt: "20:00", closesAt: "02:00" },
    });
    // Monday 2026-06-08 23:00 -> inside the window
    expect(resolveBusinessHours({ timezone: "UTC", workingHours: hours, now: new Date("2026-06-08T23:00:00Z") }).open).toBe(true);
    // Tuesday 2026-06-09 01:00 -> still inside Monday's overnight window
    expect(resolveBusinessHours({ timezone: "UTC", workingHours: hours, now: new Date("2026-06-09T01:00:00Z") }).open).toBe(true);
    // Tuesday 2026-06-09 10:00 -> closed (before the 20:00 open)
    expect(resolveBusinessHours({ timezone: "UTC", workingHours: hours, now: new Date("2026-06-09T10:00:00Z") }).open).toBe(false);
  });

  it("is timezone aware for the same instant", () => {
    const now = new Date("2026-06-10T02:00:00Z"); // Wed 02:00 UTC
    // In UTC: 02:00 -> closed (before 09:00)
    expect(resolveBusinessHours({ timezone: "UTC", workingHours: week(), now }).open).toBe(false);
    // In Asia/Tokyo (+09:00): 11:00 local -> open
    expect(resolveBusinessHours({ timezone: "Asia/Tokyo", workingHours: week(), now }).open).toBe(true);
  });

  it("handles DST: the next-open UTC instant shifts with the offset", () => {
    // America/New_York springs forward on 2026-03-08. Weekdays-only business
    // open 09:00 local, so a Friday-evening query skips the weekend to Monday.
    const weekdays = week({ saturday: { enabled: false, opensAt: "09:00", closesAt: "17:00" }, sunday: { enabled: false, opensAt: "09:00", closesAt: "17:00" } });
    // Friday 2026-03-06 22:30 UTC = 17:30 EST -> after close.
    const friAfterClose = resolveBusinessHours({ timezone: "America/New_York", workingHours: weekdays, now: new Date("2026-03-06T22:30:00Z") });
    // Monday 2026-03-09 opening is 09:00 EDT (offset -4 after DST) = 13:00 UTC.
    expect(friAfterClose.nextOpen?.atIso).toBe("2026-03-09T13:00:00.000Z");
    // Pre-DST: Thursday 2026-03-05 23:30 UTC = 18:30 EST -> after close;
    // Friday opening is 09:00 EST (offset -5, before DST) = 14:00 UTC.
    const thuAfterClose = resolveBusinessHours({ timezone: "America/New_York", workingHours: weekdays, now: new Date("2026-03-05T23:30:00Z") });
    expect(thuAfterClose.nextOpen?.atIso).toBe("2026-03-06T14:00:00.000Z");
  });

  it("a business-wide closed range beats the weekly schedule", () => {
    const now = new Date("2026-06-10T14:00:00Z"); // normally open
    const s = resolveBusinessHours({
      timezone: "UTC",
      workingHours: week(),
      now,
      closedRanges: [{ start: new Date("2026-06-10T00:00:00Z"), end: new Date("2026-06-11T00:00:00Z") }],
    });
    expect(s).toMatchObject({ open: false, reason: "blocked" });
    // next opening skips the rest of the blocked day -> Thursday
    expect(s.nextOpen).toMatchObject({ localDate: "2026-06-11" });
  });

  it("fails conservatively when the timezone is missing or invalid", () => {
    expect(resolveBusinessHours({ timezone: null, workingHours: week(), now: new Date() })).toMatchObject({ resolved: false, open: false, reason: "unresolved" });
    expect(resolveBusinessHours({ timezone: "Not/AZone", workingHours: week(), now: new Date() })).toMatchObject({ resolved: false, open: false });
  });
});
