import { z } from "zod";

// Shared academic-calendar payload — the school's first AcademicYear plus its
// three Terms, created in one transaction.
//
// WHY THIS EXISTS. docs/modules/academic-calendar-bootstrap.md (#198): every
// newly provisioned school landed with no academic year and no term, so it
// could not enroll a student, issue an invoice, or mark a register. A
// production census on 2026-08-21 found 36 of 42 real schools (86%) in that
// state.
//
// WHY THIS IS ASKED RATHER THAN SEEDED. AcademicYear and Term both carry
// non-null dates, so a seed would have to guess them, and the dates are
// load-bearing: resolveTermForDate() resolves attendance purely by date range
// (a wrong range either hard-fails or silently attributes every register to
// the wrong term), FinanceService attributes expenses by the term's range
// because Expense has no termId of its own, and the range is printed on the
// report-card PDF handed to parents. A school signing up in February would
// get a seeded calendar for a term that ended two months ago. See the
// plan-first's §2 for the full argument, and subjects.ts for the precedent it
// applies — seed only what is universally TRUE. Three terms named
// First/Second/Third passes that test; a specific school's dates do not.
//
// The defaults below are a SUGGESTION the owner sees and confirms, not a
// guess written on their behalf — that distinction is the whole design.
//
// Used by BOTH surfaces, deliberately one schema: onboarding step 5 (schools
// still in the wizard) and POST /schools/me/academic-calendar (schools that
// already completed onboarding and are stuck). The census found those
// populations roughly equal in production — 13 vs 23 — so neither is a
// secondary case.

export const TERM_SEQUENCES = [1, 2, 3] as const;

export const academicCalendarTermSchema = z
  .object({
    sequence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    name: z.string().trim().min(1).max(50),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .strict();

export type AcademicCalendarTermInput = z.infer<typeof academicCalendarTermSchema>;

// Every rule here is enforced server-side. The form mirrors them for
// immediate feedback, but the API is the authority — a hand-rolled request
// must not be able to create the overlapping or out-of-bounds terms that
// would make resolveTermForDate() ambiguous.
export const academicCalendarSchema = z
  .object({
    // Matches AcademicYear.label's own max(20) in create-academic-year.dto.ts.
    yearLabel: z.string().trim().min(1).max(20),
    yearStartDate: z.coerce.date(),
    yearEndDate: z.coerce.date(),
    terms: z.array(academicCalendarTermSchema).length(3),
    // Which of the three is `isCurrent`. Sent explicitly rather than derived
    // from "which range contains today", because a school setting up during
    // the holidays sits between two terms and still has to be in one of them
    // as far as the roster is concerned.
    currentTermSequence: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .strict()
  .superRefine((cal, ctx) => {
    if (cal.yearEndDate <= cal.yearStartDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["yearEndDate"],
        message: "Academic year end date must be after its start date.",
      });
    }

    const sequences = cal.terms.map((t) => t.sequence);
    if (new Set(sequences).size !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terms"],
        message: "Terms must have distinct sequences 1, 2 and 3.",
      });
      return; // later checks assume one term per sequence
    }

    const ordered = [...cal.terms].sort((a, b) => a.sequence - b.sequence);

    ordered.forEach((term, i) => {
      if (term.endDate <= term.startDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["terms", i, "endDate"],
          message: `${term.name} must end after it starts.`,
        });
      }
      if (term.startDate < cal.yearStartDate || term.endDate > cal.yearEndDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["terms", i],
          message: `${term.name} must fall within the academic year.`,
        });
      }
      // Non-overlap. Terms may have gaps between them — that is a holiday,
      // and attendance correctly refuses those dates — but they must never
      // overlap, or resolveTermForDate()'s findFirst would pick arbitrarily
      // between two valid answers.
      const prev = ordered[i - 1];
      if (prev && term.startDate <= prev.endDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["terms", i, "startDate"],
          message: `${term.name} must start after ${prev.name} ends.`,
        });
      }
    });

    if (!sequences.includes(cal.currentTermSequence)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["currentTermSequence"],
        message: "The current term must be one of the three terms.",
      });
    }
  });

export type AcademicCalendarInput = z.infer<typeof academicCalendarSchema>;

// ---------------------------------------------------------------------------
// Suggested defaults
// ---------------------------------------------------------------------------

// Typical Nigerian private-school calendar. September start, July finish,
// three terms with holiday gaps at Christmas and Easter. These are the most
// common shape, NOT a universal truth — which is exactly why they are
// rendered into an editable form rather than written silently.
//
// Month is 0-indexed to match Date.UTC.
const TERM_TEMPLATE: ReadonlyArray<{
  sequence: 1 | 2 | 3;
  name: string;
  start: readonly [number, number];
  end: readonly [number, number];
}> = [
  { sequence: 1, name: "First Term", start: [8, 1], end: [11, 15] }, // Sep 1 – Dec 15
  { sequence: 2, name: "Second Term", start: [0, 8], end: [3, 5] }, //  Jan 8 – Apr 5
  { sequence: 3, name: "Third Term", start: [3, 20], end: [6, 31] }, // Apr 20 – Jul 31
];

// The month (0-indexed) an academic year is taken to begin. September.
const YEAR_START_MONTH = 8;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

export interface ProposedAcademicCalendar {
  yearLabel: string;
  yearStartDate: Date;
  yearEndDate: Date;
  terms: Array<{ sequence: 1 | 2 | 3; name: string; startDate: Date; endDate: Date }>;
  currentTermSequence: 1 | 2 | 3;
  /**
   * True when `currentTermSequence` was chosen because its range actually
   * contains `today`. False when today falls in a holiday gap (or outside the
   * year entirely) and the nearest term was chosen instead — the UI uses this
   * to say so plainly rather than implying more certainty than there is.
   */
  currentTermContainsToday: boolean;
}

/**
 * Proposes a calendar to pre-fill the setup form with. Pure — `today` is
 * injected so this is testable and so callers in different timezones agree.
 *
 * The starting year is chosen so that today falls inside it: from September
 * onward the year is thisYear/thisYear+1; before September it is the year
 * that began last September. That is what stops a school signing up in
 * February from being offered a calendar that has not started yet.
 */
export function proposeAcademicCalendar(today: Date = new Date()): ProposedAcademicCalendar {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const startYear = m >= YEAR_START_MONTH ? y : y - 1;

  const terms = TERM_TEMPLATE.map((t) => {
    // Terms 2 and 3 fall in the calendar year AFTER the year starts.
    const calendarYear = t.start[0] >= YEAR_START_MONTH ? startYear : startYear + 1;
    return {
      sequence: t.sequence,
      name: t.name,
      startDate: utcDate(calendarYear, t.start[0], t.start[1]),
      endDate: utcDate(calendarYear, t.end[0], t.end[1]),
    };
  });

  const containing = terms.find((t) => today >= t.startDate && today <= t.endDate);

  // No term contains today — the school is setting up during a holiday.
  // Choose the term whose start is nearest to today, so the owner's default
  // is the one they are about to be in (or just left) rather than always
  // First Term.
  const nearest = terms.reduce((best, t) =>
    Math.abs(t.startDate.getTime() - today.getTime()) <
    Math.abs(best.startDate.getTime() - today.getTime())
      ? t
      : best,
  );

  const current = containing ?? nearest;

  return {
    yearLabel: `${startYear}/${startYear + 1}`,
    yearStartDate: utcDate(startYear, YEAR_START_MONTH, 1),
    yearEndDate: utcDate(startYear + 1, 6, 31),
    terms,
    currentTermSequence: current.sequence,
    currentTermContainsToday: containing !== undefined,
  };
}
