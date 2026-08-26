import { describe, expect, it } from "vitest";
import type { AcademicYearDto, TermDto } from "@school-kit/types";

import { feeScopeWarning, feeScopeWarningText } from "./fee-scope-warning";

const CURRENT_YEAR = "y-2025";
const OTHER_YEAR = "y-2026";

const years = [
  { id: CURRENT_YEAR, label: "2025/2026", isCurrent: true },
  { id: OTHER_YEAR, label: "2026/2027", isCurrent: false },
] as AcademicYearDto[];

const terms = [
  { id: "t-cur-2", name: "Second Term", academicYearId: CURRENT_YEAR, isCurrent: true },
  { id: "t-oth-2", name: "Second Term", academicYearId: OTHER_YEAR, isCurrent: false },
] as TermDto[];

describe("fee scope warning", () => {
  it("warns on the EXACT trap: same term name, wrong academic year", () => {
    // The real 2026-08-26 configuration — "Second Term" of 2026/2027 chosen
    // while the school is in "Second Term" of 2025/2026.
    const w = feeScopeWarning({
      academicYearId: OTHER_YEAR,
      termId: "t-oth-2",
      years,
      terms,
    });
    expect(w).toEqual({
      kind: "TERM_IN_OTHER_YEAR",
      termName: "Second Term",
      yearLabel: "2026/2027",
    });
    // The message must say what will actually HAPPEN, not just that something
    // is unusual — "will NOT include this fee" is the whole point.
    expect(feeScopeWarningText(w!)).toContain("will NOT include this fee");
    expect(feeScopeWarningText(w!)).toContain("2026/2027");
  });

  it("warns on a non-current year even with no term chosen", () => {
    const w = feeScopeWarning({ academicYearId: OTHER_YEAR, termId: null, years, terms });
    expect(w?.kind).toBe("FUTURE_OR_PAST_YEAR");
  });

  it("stays SILENT for the current year and its term — no nagging", () => {
    expect(
      feeScopeWarning({ academicYearId: CURRENT_YEAR, termId: "t-cur-2", years, terms }),
    ).toBeNull();
  });

  it("stays silent for an unscoped (school-wide) item", () => {
    expect(feeScopeWarning({ academicYearId: null, termId: null, years, terms })).toBeNull();
  });

  it("stays silent for a future term WITHIN the current year", () => {
    // Scoping next term of this year is ordinary planning, not a mistake.
    const future = [
      ...terms,
      { id: "t-cur-3", name: "Third Term", academicYearId: CURRENT_YEAR, isCurrent: false },
    ] as TermDto[];
    expect(
      feeScopeWarning({ academicYearId: CURRENT_YEAR, termId: "t-cur-3", years, terms: future }),
    ).toBeNull();
  });

  it("says nothing when no year is marked current — a bigger problem than this warning", () => {
    const none = years.map((y) => ({ ...y, isCurrent: false })) as AcademicYearDto[];
    expect(
      feeScopeWarning({ academicYearId: OTHER_YEAR, termId: "t-oth-2", years: none, terms }),
    ).toBeNull();
  });
});
