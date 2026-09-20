import { describe, expect, it } from "vitest";

import {
  addDays,
  buildMonthGrid,
  entriesOnDate,
  entryCoversDate,
  formatMonth,
  monthBounds,
  monthOf,
  shiftMonth,
} from "./month-grid";

describe("month arithmetic", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });

  it("shifts months across a year boundary in both directions", () => {
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
  });

  it("finds a month's first and last day, including February", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthBounds("2028-02").to).toBe("2028-02-29");
    expect(monthBounds("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("names a month for a heading", () => {
    expect(formatMonth("2026-09")).toBe("September 2026");
    expect(formatMonth("2026-01")).toBe("January 2026");
  });

  it("reads the month of a date", () => {
    expect(monthOf("2026-09-20")).toBe("2026-09");
  });
});

describe("buildMonthGrid", () => {
  it("always returns whole weeks", () => {
    for (const month of ["2026-01", "2026-02", "2026-09", "2028-02", "2026-11"]) {
      expect(buildMonthGrid(month).length % 7).toBe(0);
    }
  });

  it("starts on the Monday on or before the 1st", () => {
    // 1 September 2026 is a Tuesday, so the grid opens on Monday the 31st.
    const grid = buildMonthGrid("2026-09");
    expect(grid.at(0)).toEqual({ date: "2026-08-31", dayOfMonth: 31, inMonth: false });
    expect(grid.at(1)).toEqual({ date: "2026-09-01", dayOfMonth: 1, inMonth: true });
  });

  it("handles a month that begins on a Sunday without dropping a week", () => {
    // 1 November 2026 is a Sunday: six leading pad days, and the 1st must
    // still be present exactly once.
    const grid = buildMonthGrid("2026-11");
    const firstIndexes = grid
      .map((cell, index) => (cell.date === "2026-11-01" ? index : -1))
      .filter((index) => index >= 0);
    expect(firstIndexes).toEqual([6]);
  });

  it("contains every day of the month exactly once, in order", () => {
    const grid = buildMonthGrid("2026-09");
    const inMonth = grid.filter((cell) => cell.inMonth).map((cell) => cell.date);
    expect(inMonth).toHaveLength(30);
    expect(inMonth[0]).toBe("2026-09-01");
    expect(inMonth[29]).toBe("2026-09-30");
    expect(new Set(inMonth).size).toBe(30);
  });

  it("pads the tail so the last row is complete", () => {
    const grid = buildMonthGrid("2026-09");
    const last = grid[grid.length - 1];
    expect(last?.inMonth).toBe(false);
    expect(last?.date).toBe("2026-10-04");
  });
});

describe("entries on a date", () => {
  const exams = { id: "exams", startDate: "2026-09-14", endDate: "2026-09-18" };
  const meeting = { id: "meeting", startDate: "2026-09-16", endDate: "2026-09-16" };

  it("covers every day of a multi-day entry, not just its first", () => {
    // The case that matters: a teacher tapping the Wednesday of an exam week
    // must see the exams, not an empty day because the period began on Monday.
    expect(entryCoversDate(exams, "2026-09-16")).toBe(true);
    expect(entryCoversDate(exams, "2026-09-14")).toBe(true);
    expect(entryCoversDate(exams, "2026-09-18")).toBe(true);
  });

  it("excludes the days either side of the range", () => {
    expect(entryCoversDate(exams, "2026-09-13")).toBe(false);
    expect(entryCoversDate(exams, "2026-09-19")).toBe(false);
  });

  it("returns every entry touching a date, in the order given", () => {
    expect(entriesOnDate([exams, meeting], "2026-09-16").map((e) => e.id)).toEqual([
      "exams",
      "meeting",
    ]);
    expect(entriesOnDate([exams, meeting], "2026-09-17").map((e) => e.id)).toEqual(["exams"]);
    expect(entriesOnDate([exams, meeting], "2026-09-30")).toEqual([]);
  });
});
