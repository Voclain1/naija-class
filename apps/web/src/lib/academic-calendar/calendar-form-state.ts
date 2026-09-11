// The academic-calendar form's state, and the client-side mirror of the
// server's validation rules.
//
// WHY THIS IS A PURE MODULE, SEPARATE FROM calendar-form-fields.tsx. Two
// reasons, both load-bearing:
//
//  1. apps/web's Vitest runner is `environment: "node"` and `*.spec.ts` only
//     (see vitest.config.ts) — it covers pure logic extracted OUT of
//     components, and cannot import a .tsx. Rules that are only exercised
//     through JSX are rules with no executable guard, which is the precise
//     situation the 2026-08-25 carry-over incident established this runner to
//     stop.
//  2. The bounds rules below used to exist only on the server. The schema's
//     own header claimed "The form mirrors them for immediate feedback" —
//     that was an intent, never an implementation, and a real school hit the
//     gap on 2026-09-11 (see validateCalendarState).
//
// calendar-form-fields.tsx re-exports these so existing import sites are
// unchanged.

import { academicCalendarSchema, proposeAcademicCalendar } from "@school-kit/types";
import type { AcademicCalendarInput } from "@school-kit/types";

export interface CalendarFormState {
  yearLabel: string;
  yearStartDate: string;
  yearEndDate: string;
  terms: Array<{ sequence: 1 | 2 | 3; name: string; startDate: string; endDate: string }>;
  currentTermSequence: 1 | 2 | 3;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function initialCalendarState(today: Date = new Date()): {
  state: CalendarFormState;
  currentTermContainsToday: boolean;
} {
  const p = proposeAcademicCalendar(today);
  return {
    currentTermContainsToday: p.currentTermContainsToday,
    state: {
      yearLabel: p.yearLabel,
      yearStartDate: toDateInput(p.yearStartDate),
      yearEndDate: toDateInput(p.yearEndDate),
      terms: p.terms.map((t) => ({
        sequence: t.sequence,
        name: t.name,
        startDate: toDateInput(t.startDate),
        endDate: toDateInput(t.endDate),
      })),
      currentTermSequence: p.currentTermSequence,
    },
  };
}

// Dates are sent as YYYY-MM-DD strings; the server's z.coerce.date() parses
// them as UTC midnight, which is what the @db.Date columns want — see
// CLAUDE.md's "midnight in which zone?" note.
export function toCalendarInput(s: CalendarFormState): AcademicCalendarInput {
  return {
    yearLabel: s.yearLabel,
    yearStartDate: new Date(s.yearStartDate),
    yearEndDate: new Date(s.yearEndDate),
    terms: s.terms.map((t) => ({
      sequence: t.sequence,
      name: t.name,
      startDate: new Date(t.startDate),
      endDate: new Date(t.endDate),
    })),
    currentTermSequence: s.currentTermSequence,
  } as AcademicCalendarInput;
}

// ---------------------------------------------------------------------------
// Client-side validation
// ---------------------------------------------------------------------------

/** Per-term messages, indexed to match `CalendarFormState.terms`. */
export interface TermFieldErrors {
  name?: string;
  startDate?: string;
  endDate?: string;
  /** An error about the row as a whole — e.g. it falls outside the year. */
  row?: string;
}

export interface CalendarFieldErrors {
  yearLabel?: string;
  yearStartDate?: string;
  yearEndDate?: string;
  currentTermSequence?: string;
  /** Same length and order as the form's terms. */
  terms: TermFieldErrors[];
  /** Every message, server order, for the summary block. Empty when valid. */
  all: string[];
}

export function hasCalendarErrors(errors: CalendarFieldErrors): boolean {
  return errors.all.length > 0;
}

/** True when any message belongs to a term row — the cue to reveal the rows. */
export function hasTermErrors(errors: CalendarFieldErrors): boolean {
  return errors.terms.some((t) => t.name || t.startDate || t.endDate || t.row);
}

/**
 * Runs THE SERVER'S OWN SCHEMA against the form state.
 *
 * Deliberately not a hand-rolled re-implementation of the bounds, ordering and
 * overlap rules. A second copy drifts, and a drifted copy is worse than none:
 * it would either block a payload the API accepts, or wave through one it
 * rejects — landing the user back at the generic error this change exists to
 * remove. Importing `academicCalendarSchema` makes drift impossible by
 * construction; the API remains the authority, this is the same authority
 * consulted a moment earlier.
 *
 * THE BUG THIS CLOSES (2026-09-11). The form pre-fills a year of
 * 2026-09-01 → 2027-07-31 with three terms inside it. An owner who changed
 * only the YEAR dates — the most natural edit, and the two fields sitting at
 * the top of the form — left the term dates outside the new range. The terms
 * are collapsed behind a "Check or edit term dates" toggle, so the fields that
 * had just become invalid were not even on screen. The API correctly returned
 * 400, and the UI rendered its constant message: "Invalid request payload".
 */
export function validateCalendarState(state: CalendarFormState): CalendarFieldErrors {
  const errors: CalendarFieldErrors = {
    terms: state.terms.map(() => ({})),
    all: [],
  };

  const result = academicCalendarSchema.safeParse(toCalendarInput(state));
  if (result.success) return errors;

  for (const issue of result.error.issues) {
    errors.all.push(issue.message);

    const [head, second, third] = issue.path;

    if (head === "terms" && typeof second === "number") {
      const row = errors.terms[second];
      // A row can exist in the payload but not in `state.terms` only if the
      // two ever disagreed on length; guard rather than crash the form.
      if (!row) continue;
      if (third === "name" || third === "startDate" || third === "endDate") {
        row[third] ??= issue.message;
      } else {
        row.row ??= issue.message;
      }
      continue;
    }

    if (
      head === "yearLabel" ||
      head === "yearStartDate" ||
      head === "yearEndDate" ||
      head === "currentTermSequence"
    ) {
      errors[head] ??= issue.message;
    }
    // Anything else (a bare ["terms"] issue, or a whole-object issue) is
    // carried by `all` and shown in the summary block.
  }

  return errors;
}
