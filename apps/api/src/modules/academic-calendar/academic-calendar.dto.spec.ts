import { describe, expect, it } from "vitest";

import {
  academicCalendarSchema,
  proposeAcademicCalendar,
  type AcademicCalendarInput,
} from "@school-kit/types";

// Pure unit tests — no DB. Lives in apps/api rather than packages/types
// because packages/types has no test harness of its own and inventing one for
// this would be a bigger change than the feature.
//
// These matter more than usual: the whole argument for asking rather than
// seeding (docs/modules/academic-calendar-bootstrap.md §2) rests on term
// dates being load-bearing, so the rules that keep them coherent are the
// safety net for every enrollment, invoice and register that hangs off them.

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

function validCalendar(): AcademicCalendarInput {
  return {
    yearLabel: "2026/2027",
    yearStartDate: utc(2026, 8, 1),
    yearEndDate: utc(2027, 6, 31),
    terms: [
      { sequence: 1, name: "First Term", startDate: utc(2026, 8, 1), endDate: utc(2026, 11, 15) },
      { sequence: 2, name: "Second Term", startDate: utc(2027, 0, 8), endDate: utc(2027, 3, 5) },
      { sequence: 3, name: "Third Term", startDate: utc(2027, 3, 20), endDate: utc(2027, 6, 31) },
    ],
    currentTermSequence: 1,
  };
}

describe("academicCalendarSchema", () => {
  it("accepts a well-formed calendar", () => {
    expect(academicCalendarSchema.safeParse(validCalendar()).success).toBe(true);
  });

  it("rejects a year that ends before it starts", () => {
    const cal = { ...validCalendar(), yearEndDate: utc(2025, 6, 31) };
    expect(academicCalendarSchema.safeParse(cal).success).toBe(false);
  });

  it("rejects a term that ends before it starts", () => {
    const cal = validCalendar();
    cal.terms[1] = { ...cal.terms[1]!, endDate: utc(2026, 11, 20) };
    expect(academicCalendarSchema.safeParse(cal).success).toBe(false);
  });

  // The rule that protects resolveTermForDate(): overlapping terms would make
  // its findFirst pick arbitrarily between two valid answers, so an
  // attendance record's term would depend on row order.
  it("rejects overlapping terms", () => {
    const cal = validCalendar();
    cal.terms[1] = { ...cal.terms[1]!, startDate: utc(2026, 11, 1) }; // starts before First ends
    const res = academicCalendarSchema.safeParse(cal);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /must start after/.test(i.message))).toBe(true);
    }
  });

  // A gap is legitimate — it is the Christmas or Easter holiday, and
  // attendance correctly refuses those dates.
  it("accepts gaps between terms", () => {
    expect(academicCalendarSchema.safeParse(validCalendar()).success).toBe(true);
  });

  it("rejects a term outside the academic year's bounds", () => {
    const cal = validCalendar();
    cal.terms[2] = { ...cal.terms[2]!, endDate: utc(2027, 8, 30) }; // past year end
    expect(academicCalendarSchema.safeParse(cal).success).toBe(false);
  });

  it("rejects duplicate term sequences", () => {
    const cal = validCalendar();
    cal.terms[1] = { ...cal.terms[1]!, sequence: 1 };
    expect(academicCalendarSchema.safeParse(cal).success).toBe(false);
  });

  it("rejects anything other than exactly three terms", () => {
    const cal = validCalendar();
    expect(
      academicCalendarSchema.safeParse({ ...cal, terms: cal.terms.slice(0, 2) }).success,
    ).toBe(false);
  });

  it("rejects unknown keys (.strict)", () => {
    expect(
      academicCalendarSchema.safeParse({ ...validCalendar(), stowaway: true }).success,
    ).toBe(false);
  });
});

describe("proposeAcademicCalendar", () => {
  // The February counter-example from the plan-first §D3 — the single case
  // that decided against seeding. A school setting up mid-year must be
  // offered the year it is ACTUALLY in, not one starting next September.
  it("offers the in-progress year to a school setting up in February", () => {
    const p = proposeAcademicCalendar(utc(2027, 1, 10));
    expect(p.yearLabel).toBe("2026/2027");
    expect(p.currentTermSequence).toBe(2);
    expect(p.currentTermContainsToday).toBe(true);
  });

  it("offers the new year to a school setting up in October", () => {
    const p = proposeAcademicCalendar(utc(2026, 9, 15));
    expect(p.yearLabel).toBe("2026/2027");
    expect(p.currentTermSequence).toBe(1);
    expect(p.currentTermContainsToday).toBe(true);
  });

  it("offers the in-progress year to a school setting up in June", () => {
    const p = proposeAcademicCalendar(utc(2027, 5, 1));
    expect(p.yearLabel).toBe("2026/2027");
    expect(p.currentTermSequence).toBe(3);
    expect(p.currentTermContainsToday).toBe(true);
  });

  // Christmas holiday: no term contains today. The proposal must still pick
  // one, and must be honest that it is not a containing match — the form
  // uses this to say so rather than implying false precision.
  it("flags when today falls in a holiday gap", () => {
    const p = proposeAcademicCalendar(utc(2026, 11, 28));
    expect(p.currentTermContainsToday).toBe(false);
    expect([1, 2]).toContain(p.currentTermSequence);
  });

  it("always proposes a payload its own schema accepts", () => {
    // Every day of a full year — the proposal must never emit something the
    // API would reject, or the form's pre-fill would be dead on arrival.
    for (let i = 0; i < 365; i += 1) {
      const day = new Date(Date.UTC(2026, 0, 1) + i * 24 * 60 * 60 * 1000);
      const p = proposeAcademicCalendar(day);
      const res = academicCalendarSchema.safeParse({
        yearLabel: p.yearLabel,
        yearStartDate: p.yearStartDate,
        yearEndDate: p.yearEndDate,
        terms: p.terms,
        currentTermSequence: p.currentTermSequence,
      });
      expect(res.success, `failed for ${day.toISOString()}`).toBe(true);
    }
  });
});
