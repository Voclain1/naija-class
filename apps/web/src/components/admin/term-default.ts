// What the topbar term selector should write into the URL of a term-aware
// page (/dashboard, /insights), given what it has resolved for this visit and
// what the URL already carries. Pure, so the rule is testable without a DOM
// (apps/web's Vitest runs in node; see vitest.config.ts).

export interface TermResolution {
  /** The school has no academic year at all (a brand-new school). */
  noAcademicYear: boolean;
  /** The current term, else the year's first; null when the year has none. */
  defaultTermId: string | null;
}

export function defaultParamToWrite(
  resolution: TermResolution | null,
  termIdInUrl: string,
  noAcademicYearInUrl: boolean,
): { key: "termId" | "noAcademicYear"; value: string } | null {
  // Still fetching for this visit, or the person already has a term.
  if (!resolution || termIdInUrl) return null;
  if (resolution.noAcademicYear) {
    return noAcademicYearInUrl ? null : { key: "noAcademicYear", value: "1" };
  }
  return resolution.defaultTermId ? { key: "termId", value: resolution.defaultTermId } : null;
}
