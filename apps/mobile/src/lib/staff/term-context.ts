import type { AcademicYearDto, TermDto } from "@school-kit/types";

// Resolving "which term am I looking at" for the bursar surface.
//
// WHY THIS FILE EXISTS AT ALL — and why it is a client-side chain rather than
// one request (D16, option (a)):
//
// Both finance endpoints require `termId` and have NO server-side current-term
// fallback. `dashboard.dto.ts` says so explicitly, mirroring
// `listDebtorsSchema`, and that was a deliberate decision: the web finance
// pages resolve "current" through a year/term selector the user is already
// looking at, so the server never needed to guess.
//
// A teacher does not have this problem, because teachers were GIVEN
// `/teacher-scope/me` — precisely because they lack `term.read` and could not
// resolve a term at all. A bursar HOLDS `term.read` and `academic-year.read`
// (the 2026-08-02 RBAC gap-closure), so nobody ever built them the
// convenience. The permission that makes the bursar self-sufficient is the
// same one that left them without a shortcut.
//
// The cost is two extra sequential round-trips before anything renders. CP3
// pays it rather than changing the server, which keeps this checkpoint honest
// to CP2's mobile-only precedent. `measureTermResolution` below exists so that
// cost is a NUMBER rather than an opinion: if a real network makes the cold
// open unacceptable, that measurement is the argument for a server-side
// change, made with evidence in its own PR.

export interface ResolvedTerm {
  yearId: string;
  yearLabel: string;
  termId: string;
  termName: string;
}

export type TermResolutionFailure =
  | "NO_ACADEMIC_YEAR"
  | "NO_CURRENT_YEAR"
  | "NO_TERM_IN_YEAR"
  | "NO_CURRENT_TERM";

export interface TermResolution {
  term: ResolvedTerm | null;
  failure: TermResolutionFailure | null;
}

/**
 * Pick the current year and term from what the two list endpoints returned.
 *
 * Pure, so the branching is unit-testable without a network. Every failure is
 * NAMED rather than collapsed into null: a school with no academic year at all
 * is a different problem from a school whose year exists but has no term
 * marked current, and the bursar should be told which — the second is a
 * two-click fix in settings, the first is not. This is the same class of
 * failure the academic-calendar work (#198) had to go and find in production
 * because nothing surfaced it.
 */
export function resolveCurrentTerm(
  years: readonly AcademicYearDto[],
  termsOfYear: readonly TermDto[] | null,
): TermResolution {
  if (years.length === 0) return { term: null, failure: "NO_ACADEMIC_YEAR" };

  const year = years.find((y) => y.isCurrent);
  if (!year) return { term: null, failure: "NO_CURRENT_YEAR" };

  if (termsOfYear === null || termsOfYear.length === 0) {
    return { term: null, failure: "NO_TERM_IN_YEAR" };
  }

  const term = termsOfYear.find((t) => t.isCurrent);
  if (!term) return { term: null, failure: "NO_CURRENT_TERM" };

  return {
    term: { yearId: year.id, yearLabel: year.label, termId: term.id, termName: term.name },
    failure: null,
  };
}

/** What to tell a bursar who cannot be shown any figures. */
export function termResolutionMessage(failure: TermResolutionFailure): string {
  switch (failure) {
    case "NO_ACADEMIC_YEAR":
      return "This school has no academic year set up yet. Collections can't be shown until one exists.";
    case "NO_CURRENT_YEAR":
      return "No academic year is marked as current. Ask an administrator to set one.";
    case "NO_TERM_IN_YEAR":
      return "The current academic year has no terms yet. Collections are reported per term.";
    case "NO_CURRENT_TERM":
      return "No term is marked as current. Ask an administrator to set one.";
  }
}
