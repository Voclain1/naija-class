import { describe, expect, it } from "vitest";

import {
  addDaysIso,
  defaultCalendarWindow,
  formatCalendarMonth,
  formatCalendarRange,
  lagosTodayIso,
} from "@school-kit/types";

// The shared client-side date helpers (packages/types/src/calendar/calendar-dates.ts).
// Tested here because packages/types has no test runner of its own.

describe("calendar date helpers (D29)", () => {
  it("uses the Lagos calendar day, not UTC: 23:30 UTC on 31 Dec is already 1 Jan in Lagos", () => {
    expect(lagosTodayIso(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(lagosTodayIso(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });

  it("adds days across month and year boundaries", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("the default window starts on the first of the Lagos month and spans 180 days", () => {
    expect(defaultCalendarWindow(new Date("2026-09-13T10:00:00Z"))).toEqual({ from: "2026-09-01", to: "2027-02-28" });
    expect(defaultCalendarWindow(new Date("2026-09-30T23:30:00Z")).from).toBe("2026-10-01");
  });

  it("formats single days and ranges without shifting the date", () => {
    expect(formatCalendarRange("2026-06-12", "2026-06-12")).toBe("Fri 12 Jun 2026");
    expect(formatCalendarRange("2026-03-19", "2026-03-20")).toBe("Thu 19 Mar – Fri 20 Mar 2026");
    expect(formatCalendarRange("2026-12-31", "2027-01-02")).toBe("Thu 31 Dec 2026 – Sat 2 Jan 2027");
    expect(formatCalendarMonth("2026-06-12")).toBe("June 2026");
  });
});
