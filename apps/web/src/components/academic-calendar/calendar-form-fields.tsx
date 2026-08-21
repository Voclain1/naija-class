"use client";

import { useState } from "react";

import { proposeAcademicCalendar, type AcademicCalendarInput } from "@school-kit/types";

// The academic-calendar form, shared by BOTH surfaces that need it: the
// onboarding wizard's step 5, and the recovery prompt for schools that
// finished onboarding before the step existed. The 2026-08-21 production
// census found those populations comparable (13 in-wizard vs 23 already
// active), so this is genuinely shared UI rather than a form with a
// secondary reuse.
//
// PRE-FILLED, NOT PRE-DECIDED. Every field arrives populated from
// proposeAcademicCalendar() and every field is editable. That is the whole
// design of #198: a seed would have to guess these dates silently, and the
// dates are load-bearing (attendance resolves its term purely by date range,
// finance attributes expenses by it, the report-card PDF prints it). A
// visible default the owner confirms is a suggestion; the same value written
// behind their back is a guess. See docs/modules/academic-calendar-bootstrap.md.

const INPUT_CLASSES =
  "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface CalendarFormState {
  yearLabel: string;
  yearStartDate: string;
  yearEndDate: string;
  terms: Array<{ sequence: 1 | 2 | 3; name: string; startDate: string; endDate: string }>;
  currentTermSequence: 1 | 2 | 3;
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

export function CalendarFormFields({
  state,
  onChange,
  currentTermContainsToday,
  disabled,
}: {
  state: CalendarFormState;
  onChange: (next: CalendarFormState) => void;
  currentTermContainsToday: boolean;
  disabled?: boolean;
}) {
  const [showTerms, setShowTerms] = useState(false);

  function setTerm(i: number, patch: Partial<CalendarFormState["terms"][number]>) {
    const terms = state.terms.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
    onChange({ ...state, terms });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Academic year</span>
          <input
            className={INPUT_CLASSES}
            value={state.yearLabel}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, yearLabel: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Starts</span>
          <input
            type="date"
            className={INPUT_CLASSES}
            value={state.yearStartDate}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, yearStartDate: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Ends</span>
          <input
            type="date"
            className={INPUT_CLASSES}
            value={state.yearEndDate}
            disabled={disabled}
            onChange={(e) => onChange({ ...state, yearEndDate: e.target.value })}
          />
        </label>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-foreground">
          Which term are you in now?
        </span>
        <div className="flex flex-wrap gap-2">
          {state.terms.map((t) => (
            <button
              key={t.sequence}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...state, currentTermSequence: t.sequence })}
              className={
                t.sequence === state.currentTermSequence
                  ? "rounded-md border border-primary bg-primary/10 px-3 py-2 text-sm font-medium text-primary"
                  : "rounded-md border border-input px-3 py-2 text-sm text-foreground hover:bg-muted"
              }
            >
              {t.name}
            </button>
          ))}
        </div>
        {/* Say so rather than implying precision we don't have. When today
            falls in a holiday gap the proposal picked the nearest term, and
            the owner is the only one who knows which is right. */}
        {!currentTermContainsToday && (
          <p className="mt-2 text-xs text-muted-foreground">
            Today doesn&apos;t fall inside any of these terms — you may be on holiday. Pick the term
            you&apos;re about to start, or adjust the dates below.
          </p>
        )}
      </div>

      <div>
        <button
          type="button"
          className="text-sm font-medium text-primary underline underline-offset-2"
          onClick={() => setShowTerms((v) => !v)}
        >
          {showTerms ? "Hide term dates" : "Check or edit term dates"}
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          These dates decide which term attendance and fees are recorded against, so it&apos;s worth
          a look — you can change them later in Settings → Academic.
        </p>

        {showTerms && (
          <div className="mt-3 space-y-3">
            {state.terms.map((t, i) => (
              <div key={t.sequence} className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Term {t.sequence} name</span>
                  <input
                    className={INPUT_CLASSES}
                    value={t.name}
                    disabled={disabled}
                    onChange={(e) => setTerm(i, { name: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Starts</span>
                  <input
                    type="date"
                    className={INPUT_CLASSES}
                    value={t.startDate}
                    disabled={disabled}
                    onChange={(e) => setTerm(i, { startDate: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Ends</span>
                  <input
                    type="date"
                    className={INPUT_CLASSES}
                    value={t.endDate}
                    disabled={disabled}
                    onChange={(e) => setTerm(i, { endDate: e.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
