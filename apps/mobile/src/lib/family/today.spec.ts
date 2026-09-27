import type {
  FamilyTimetableDto,
  PortalInvoiceDto,
  ReleasedResultSummaryDto,
  StudentAttendanceTermDto,
} from "@school-kit/types";
import { describe, expect, it } from "vitest";

import {
  childHighlight,
  describeLesson,
  formatHundredths,
  initials,
  latestAttendance,
  latestResult,
  nextLesson,
} from "./today";
import { isoWeekdayOf, greeting, formatLongDate, nowMinutesOfDay } from "../when";
import { studentDestinations } from "../navigation/destinations";

// What a family's home screen says (phone-for-every-role.md D4, D6).

const TIMETABLE: FamilyTimetableDto = {
  state: "PUBLISHED",
  className: "JSS2 Blue",
  termName: "First Term",
  publishedAt: "2026-09-01T09:00:00.000Z",
  grid: {
    slots: [
      { position: 1, label: "Period 1", kind: "LESSON", startMinute: 490, endMinute: 530 },
      { position: 2, label: "Period 2", kind: "LESSON", startMinute: 530, endMinute: 570 },
    ],
    days: [1, 2, 3, 4, 5],
    lessons: [
      { dayOfWeek: 3, slotPosition: 2, subjectName: "Mathematics", teacherNames: ["Mrs Eze"] },
      { dayOfWeek: 3, slotPosition: 1, subjectName: "English", teacherNames: ["Mr Bello"] },
      { dayOfWeek: 4, slotPosition: 1, subjectName: "Biology", teacherNames: [] },
    ],
  },
};

describe("the next lesson", () => {
  it("is the earliest one today that has not finished", () => {
    // 08:00 — before both of Wednesday's lessons.
    expect(nextLesson(TIMETABLE, 3, 480)?.subjectName).toBe("English");
  });

  it("counts the lesson happening NOW — a student mid-period wants to know what they are in", () => {
    expect(nextLesson(TIMETABLE, 3, 500)?.subjectName).toBe("English");
    expect(nextLesson(TIMETABLE, 3, 535)?.subjectName).toBe("Mathematics");
  });

  it("is nothing once the day is over, on a day with no lessons, or with no timetable", () => {
    expect(nextLesson(TIMETABLE, 3, 600)).toBeNull();
    expect(nextLesson(TIMETABLE, 6, 480)).toBeNull();
    expect(nextLesson(TIMETABLE, null, 480)).toBeNull();
    expect(nextLesson(undefined, 3, 480)).toBeNull();
    expect(nextLesson({ ...TIMETABLE, grid: null }, 3, 480)).toBeNull();
  });

  it("reads as subject and start time", () => {
    expect(describeLesson({ subjectName: "Mathematics", startMinute: 530, endMinute: 570, label: "Period 2" })).toBe(
      "Mathematics · 08:50",
    );
  });
});

describe("figures come from the server, formatted not computed", () => {
  it("turns integer hundredths into a percentage without inventing precision", () => {
    expect(formatHundredths(8750)).toBe("87.5%");
    expect(formatHundredths(9000)).toBe("90%");
    expect(formatHundredths(0)).toBe("0%");
    expect(formatHundredths(null)).toBeNull();
    expect(formatHundredths(undefined)).toBeNull();
  });

  it("picks the latest term that was actually marked", () => {
    const terms = [
      { termId: "t1", sequence: 1, daysMarked: 50, attendanceRate: 9000, termName: "First" },
      { termId: "t2", sequence: 2, daysMarked: 0, attendanceRate: 0, termName: "Second" },
    ] as unknown as StudentAttendanceTermDto[];
    expect(latestAttendance(terms)?.termId).toBe("t1");
    expect(latestAttendance([])).toBeNull();
  });

  it("picks the most recently released result", () => {
    const results = [
      { termId: "t1", termName: "First", releasedAt: "2026-01-10T09:00:00.000Z" },
      { termId: "t2", termName: "Second", releasedAt: "2026-04-10T09:00:00.000Z" },
    ] as unknown as ReleasedResultSummaryDto[];
    expect(latestResult(results)?.termId).toBe("t2");
    expect(latestResult([])).toBeNull();
  });
});

describe("the one line worth a parent's attention", () => {
  const owing = [
    { id: "i1", status: "PARTIALLY_PAID", totalDue: 150_000_00, totalPaid: 100_000_00 },
  ] as unknown as PortalInvoiceDto[];
  const results = [
    { termId: "t2", termName: "Second Term", releasedAt: "2026-04-10T09:00:00.000Z" },
  ] as unknown as ReleasedResultSummaryDto[];

  it("is money owed first — it is the thing with a consequence", () => {
    expect(childHighlight({ invoices: owing, results })).toEqual({
      kind: "fees",
      text: "₦50,000.00 outstanding",
      tone: "warning",
    });
  });

  it("is fresh results when nothing is owed and no homework is pending", () => {
    expect(childHighlight({ invoices: [], results })).toEqual({
      kind: "results",
      text: "Second Term results are ready",
      tone: "info",
    });
  });

  it("is overdue homework before homework merely due, and both before results", () => {
    // This ranking IS B9: posting homework sends no push, so this line is what
    // a parent sees instead, on a screen they already open.
    expect(childHighlight({ invoices: [], results, homeworkOverdue: 2, homeworkDueSoon: 1 })).toEqual({
      kind: "homework",
      text: "2 pieces of homework overdue",
      tone: "warning",
    });
    expect(childHighlight({ invoices: [], results, homeworkDueSoon: 3 })).toEqual({
      kind: "homework",
      text: "3 homework due soon",
      tone: "info",
    });
  });

  it("still puts money first — a child sent home over fees has a bigger problem", () => {
    expect(childHighlight({ invoices: owing, results, homeworkOverdue: 5 })?.kind).toBe("fees");
  });

  it("says one PIECE, not one pieces", () => {
    expect(childHighlight({ homeworkOverdue: 1 })?.text).toBe("1 piece of homework overdue");
  });

  it("is NOTHING when there is nothing to say — a home that always shouts is ignored", () => {
    expect(childHighlight({ invoices: [], results: [] })).toBeNull();
    expect(childHighlight({ homeworkDueSoon: 0, homeworkOverdue: 0 })).toBeNull();
    expect(childHighlight({})).toBeNull();
  });
});

describe("small things", () => {
  it("makes initials from whatever name the school holds", () => {
    expect(initials("Adaeze", "Okafor")).toBe("AO");
    expect(initials("David", null)).toBe("D");
    expect(initials(null, null)).toBe("?");
  });

  it("greets by the hour, and reads dates in the school's day, not the handset's zone", () => {
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(isoWeekdayOf("2026-09-23")).toBe(3);
    expect(isoWeekdayOf("2026-09-27")).toBe(7);
    expect(isoWeekdayOf(null)).toBeNull();
    expect(formatLongDate("2026-09-23")).toContain("23");
    expect(nowMinutesOfDay(new Date(2026, 8, 23, 8, 10))).toBe(490);
  });

  it("offers the tutor as a clearly unfinished thing, not a working feature", () => {
    const tutor = studentDestinations().find((d) => d.key === "tutor");
    expect(tutor).toMatchObject({ hint: "Coming soon", route: "/me/tutor" });
  });
});
