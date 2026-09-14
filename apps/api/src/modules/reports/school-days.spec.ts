import { describe, expect, it } from "vitest";

import type { CalendarEntryDto } from "@school-kit/types";

import { computeSchoolDays, eachDay, isWeekend } from "./school-days";

// Phase 8 / CP2 — the expected-days definition (docs/modules/phase-8.md §16 D33–D34, Q31).
// Pure: every case below states its answer by hand-counting a real calendar.
//
// March 2026: Mon 2, Tue 3, … Fri 6; Sat 7, Sun 8; Mon 9 … Fri 13; …; Mon 23 … Fri 27.
// Weekdays from Mon 2 to Fri 27 inclusive = 4 × 5 = 20.

const entry = (e: Partial<CalendarEntryDto> & Pick<CalendarEntryDto, "source" | "category" | "startDate">): CalendarEntryDto => ({
  id: `${e.source}:${e.startDate}:${e.category}`,
  title: e.title ?? String(e.category),
  endDate: e.endDate ?? e.startDate,
  dateConfirmed: e.dateConfirmed ?? true,
  description: null,
  ...e,
});

const EID = entry({ source: "NATIONAL", category: "PUBLIC_HOLIDAY", title: "Eid-el-Fitr", startDate: "2026-03-19", endDate: "2026-03-20" });

describe("eachDay / isWeekend", () => {
  it("lists inclusive days, including across a month end", () => {
    expect(eachDay("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(eachDay("2026-03-02", "2026-03-01")).toEqual([]);
  });

  it("knows weekends from the calendar date, independent of the machine's timezone", () => {
    expect(isWeekend("2026-03-07")).toBe(true); // Saturday
    expect(isWeekend("2026-03-08")).toBe(true); // Sunday
    expect(isWeekend("2026-03-09")).toBe(false); // Monday
  });
});

describe("computeSchoolDays", () => {
  it("a whole past term with no holidays: Monday–Friday only", () => {
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", []);
    expect(r.dto).toEqual({
      asOf: "2026-04-15",
      countedFrom: "2026-03-02",
      countedTo: "2026-03-27",
      schoolDayCount: 20,
      excludedDays: [],
    });
    expect(r.schoolDaySet.has("2026-03-07")).toBe(false);
  });

  it("stops at today during the term (today counts)", () => {
    // Mon 2 … Wed 11: 2,3,4,5,6,9,10,11 = 8
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-03-11", []);
    expect(r.dto.countedTo).toBe("2026-03-11");
    expect(r.dto.schoolDayCount).toBe(8);
  });

  it("a term that has not started yet expects nothing", () => {
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-02-27", [EID]);
    expect(r.dto).toEqual({ asOf: "2026-02-27", countedFrom: null, countedTo: null, schoolDayCount: 0, excludedDays: [] });
  });

  it("a term starting today expects exactly one day", () => {
    expect(computeSchoolDays("2026-03-02", "2026-03-27", "2026-03-02", []).dto.schoolDayCount).toBe(1);
  });

  it("a confirmed public holiday on weekdays is excluded, and each excluded day is listed with its reason", () => {
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", [EID]);
    expect(r.dto.schoolDayCount).toBe(18);
    expect(r.dto.excludedDays).toEqual([
      { date: "2026-03-19", reason: "Eid-el-Fitr (public holiday)" },
      { date: "2026-03-20", reason: "Eid-el-Fitr (public holiday)" },
    ]);
  });

  it("an UNCONFIRMED national holiday is NOT excluded — a guessed date must not forgive a missed register", () => {
    const guess = { ...EID, dateConfirmed: false };
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", [guess]);
    expect(r.dto.schoolDayCount).toBe(20);
    expect(r.dto.excludedDays).toEqual([]);
  });

  it("school HOLIDAY and BREAK events are excluded; MEETING, EVENT, EXAM_PERIOD, RESUMPTION, OTHER and term markers are not", () => {
    const cal = [
      entry({ source: "SCHOOL", category: "HOLIDAY", title: "Founders' Day", startDate: "2026-03-10" }),
      entry({ source: "SCHOOL", category: "BREAK", title: "Mid-term", startDate: "2026-03-12", endDate: "2026-03-13" }),
      entry({ source: "SCHOOL", category: "MEETING", title: "PTA", startDate: "2026-03-05" }),
      entry({ source: "SCHOOL", category: "EVENT", title: "Sports", startDate: "2026-03-06" }),
      entry({ source: "SCHOOL", category: "EXAM_PERIOD", title: "Exams", startDate: "2026-03-23", endDate: "2026-03-27" }),
      entry({ source: "SCHOOL", category: "RESUMPTION", title: "Resumption", startDate: "2026-03-02" }),
      entry({ source: "SCHOOL", category: "OTHER", title: "Other", startDate: "2026-03-03" }),
      entry({ source: "TERM", category: "TERM_START", title: "First Term begins", startDate: "2026-03-02" }),
    ];
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", cal);
    expect(r.dto.schoolDayCount).toBe(17); // 20 − 10 − 12 − 13
    expect(r.dto.excludedDays).toEqual([
      { date: "2026-03-10", reason: "Founders' Day (school holiday)" },
      { date: "2026-03-12", reason: "Mid-term (school break)" },
      { date: "2026-03-13", reason: "Mid-term (school break)" },
    ]);
  });

  it("a break spanning a weekend excludes only its weekdays, and weekends are never listed as excluded", () => {
    const cal = [entry({ source: "SCHOOL", category: "BREAK", title: "Long weekend", startDate: "2026-03-06", endDate: "2026-03-09" })];
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", cal);
    expect(r.dto.schoolDayCount).toBe(18); // 20 − Fri 6 − Mon 9
    expect(r.dto.excludedDays.map((d) => d.date)).toEqual(["2026-03-06", "2026-03-09"]);
  });

  it("a holiday overlapping the term edge is clipped to the counted range", () => {
    const cal = [entry({ source: "SCHOOL", category: "BREAK", title: "Before and into", startDate: "2026-02-25", endDate: "2026-03-03" })];
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-03-04", cal);
    // counted Mon 2, Tue 3, Wed 4; break removes 2 and 3
    expect(r.dto.schoolDayCount).toBe(1);
    expect(r.dto.excludedDays.map((d) => d.date)).toEqual(["2026-03-02", "2026-03-03"]);
  });

  it("two reasons on one day are both shown, and the day is excluded once", () => {
    const cal = [
      EID,
      entry({ source: "SCHOOL", category: "BREAK", title: "Easter break", startDate: "2026-03-20" }),
    ];
    const r = computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", cal);
    expect(r.dto.schoolDayCount).toBe(18);
    expect(r.dto.excludedDays).toContainEqual({
      date: "2026-03-20",
      reason: "Eid-el-Fitr (public holiday); Easter break (school break)",
    });
  });

  it("a holiday falling on a weekend changes nothing", () => {
    const cal = [entry({ source: "NATIONAL", category: "PUBLIC_HOLIDAY", title: "Weekend holiday", startDate: "2026-03-07" })];
    expect(computeSchoolDays("2026-03-02", "2026-03-27", "2026-04-15", cal).dto.schoolDayCount).toBe(20);
  });
});
