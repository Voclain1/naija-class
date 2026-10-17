import { describe, expect, it } from "vitest";

import { chargeTermFor, fineFor, termLateDays, type FineRule, type TermSpan } from "./library-fines";

// Phase 9 / CP6.2 — the library fine (docs/modules/phase-9.md §14 CP6-D3),
// a pure function, written before the code that uses it: rate × (late days −
// grace), never below 0, never above the cap, where late days are calendar
// days after the due date that fall inside a term. The long holiday between
// terms is not fined; mid-term breaks are.

const TERMS: TermSpan[] = [
  { id: "t1", startDate: "2026-09-07", endDate: "2026-12-11" },
  { id: "t2", startDate: "2027-01-05", endDate: "2027-04-02" },
];
const RULE: FineRule = { finePerDay: 5_000, fineGraceDays: 0, fineCap: null }; // ₦50 a day

describe("termLateDays", () => {
  it("is 0 on or before the due date", () => {
    expect(termLateDays("2026-10-10", "2026-10-09", TERMS)).toBe(0);
    expect(termLateDays("2026-10-10", "2026-10-10", TERMS)).toBe(0);
  });

  it("counts every calendar day after the due date inside a term, weekends too", () => {
    expect(termLateDays("2026-10-10", "2026-10-11", TERMS)).toBe(1);
    expect(termLateDays("2026-10-10", "2026-10-20", TERMS)).toBe(10);
  });

  it("does not count the holiday between terms", () => {
    // Due 2026-12-09: 10th and 11th Dec in term, then the holiday, then 5–7 Jan.
    expect(termLateDays("2026-12-09", "2027-01-07", TERMS)).toBe(5);
  });

  it("counts nothing when the due date and return both fall in the holiday", () => {
    expect(termLateDays("2026-12-20", "2027-01-02", TERMS)).toBe(0);
  });

  it("counts a day once where two terms overlap", () => {
    const overlapping: TermSpan[] = [...TERMS, { id: "other-year", startDate: "2026-10-01", endDate: "2026-10-31" }];
    expect(termLateDays("2026-10-10", "2026-10-13", overlapping)).toBe(3);
    // Partly overlapping, partly not: 9–11 Dec in t1, 12–15 Dec only in the extra term.
    const extended: TermSpan[] = [...TERMS, { id: "late", startDate: "2026-12-01", endDate: "2026-12-15" }];
    expect(termLateDays("2026-12-08", "2026-12-15", extended)).toBe(7);
  });

  it("starts counting when the next term starts, for a book due in the holiday", () => {
    expect(termLateDays("2026-12-20", "2027-01-06", TERMS)).toBe(2);
  });
});

describe("fineFor", () => {
  it("is rate × late days, in kobo", () => {
    expect(fineFor("2026-10-10", "2026-10-13", TERMS, RULE)).toBe(15_000);
  });

  it("forgives the grace days, and is 0 within them", () => {
    const rule = { ...RULE, fineGraceDays: 2 };
    expect(fineFor("2026-10-10", "2026-10-12", TERMS, rule)).toBe(0);
    expect(fineFor("2026-10-10", "2026-10-15", TERMS, rule)).toBe(15_000);
  });

  it("never goes above the cap", () => {
    expect(fineFor("2026-10-10", "2026-11-30", TERMS, { ...RULE, fineCap: 100_000 })).toBe(100_000);
  });

  it("is 0 at a rate of 0 and on time", () => {
    expect(fineFor("2026-10-10", "2026-11-30", TERMS, { ...RULE, finePerDay: 0 })).toBe(0);
    expect(fineFor("2026-10-10", "2026-10-10", TERMS, RULE)).toBe(0);
  });
});

describe("chargeTermFor", () => {
  it("is the term the date falls in", () => {
    expect(chargeTermFor("2026-10-01", TERMS)).toBe("t1");
  });

  it("is the current term where two terms hold the date", () => {
    const overlapping: TermSpan[] = [{ id: "old", startDate: "2026-09-01", endDate: "2026-12-31" }, { ...TERMS[0]!, isCurrent: true }];
    expect(chargeTermFor("2026-10-01", overlapping)).toBe("t1");
  });

  it("is the next term to start, for a date in a holiday", () => {
    expect(chargeTermFor("2026-12-25", TERMS)).toBe("t2");
  });

  it("is the last term to end when no later term is set up", () => {
    expect(chargeTermFor("2027-05-01", TERMS)).toBe("t2");
  });

  it("is null with no terms at all", () => {
    expect(chargeTermFor("2027-05-01", [])).toBeNull();
  });
});
