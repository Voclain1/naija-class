"use client";

import { useEffect, useState } from "react";

import {
  hasTermErrors,
  type CalendarFieldErrors,
  type CalendarFormState,
} from "@/lib/academic-calendar/calendar-form-state";

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
//
// The state shape, the payload mapping and the validation mirror now live in
// lib/academic-calendar/calendar-form-state.ts so they can be unit-tested --
// apps/web's Vitest runner is node-only and cannot import this file. They are
// re-exported here so existing import sites are unchanged.
export {
  initialCalendarState,
  toCalendarInput,
  validateCalendarState,
  hasCalendarErrors,
  hasTermErrors,
} from "@/lib/academic-calendar/calendar-form-state";
export type {
  CalendarFormState,
  CalendarFieldErrors,
  TermFieldErrors,
} from "@/lib/academic-calendar/calendar-form-state";

const INPUT_CLASSES =
  "rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

// Applied on top of INPUT_CLASSES for a field the validator flagged. The ring
// colour moves too, so the field stays legibly wrong while it has focus.
const INPUT_INVALID_CLASSES = "border-destructive focus:ring-destructive";

function inputClasses(invalid: boolean | undefined): string {
  return invalid ? `${INPUT_CLASSES} ${INPUT_INVALID_CLASSES}` : INPUT_CLASSES;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="text-xs text-destructive">{message}</span>;
}

export function CalendarFormFields({
  state,
  onChange,
  currentTermContainsToday,
  disabled,
  errors,
}: {
  state: CalendarFormState;
  onChange: (next: CalendarFormState) => void;
  currentTermContainsToday: boolean;
  disabled?: boolean;
  /**
   * Field-level messages from validateCalendarState(). Optional so the
   * component still renders for any caller that has not wired validation.
   */
  errors?: CalendarFieldErrors;
}) {
  const [showTerms, setShowTerms] = useState(false);

  const termsInvalid = errors ? hasTermErrors(errors) : false;

  // AUTO-EXPAND. The term rows are collapsed by default, which is right when
  // the defaults are being accepted -- but it was the trap in the 2026-09-11
  // incident: changing the YEAR dates invalidates the pre-filled TERM dates,
  // and the fields that had just gone wrong were not on screen to see. Reveal
  // them the moment they are implicated. Not forced open: this sets the same
  // state the toggle does, so an owner who has read them can still collapse.
  useEffect(() => {
    if (termsInvalid) setShowTerms(true);
  }, [termsInvalid]);

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
            className={inputClasses(Boolean(errors?.yearLabel))}
            value={state.yearLabel}
            disabled={disabled}
            aria-invalid={Boolean(errors?.yearLabel)}
            onChange={(e) => onChange({ ...state, yearLabel: e.target.value })}
          />
          <FieldError message={errors?.yearLabel} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Starts</span>
          <input
            type="date"
            className={inputClasses(Boolean(errors?.yearStartDate))}
            value={state.yearStartDate}
            disabled={disabled}
            aria-invalid={Boolean(errors?.yearStartDate)}
            onChange={(e) => onChange({ ...state, yearStartDate: e.target.value })}
          />
          <FieldError message={errors?.yearStartDate} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Ends</span>
          <input
            type="date"
            className={inputClasses(Boolean(errors?.yearEndDate))}
            value={state.yearEndDate}
            disabled={disabled}
            aria-invalid={Boolean(errors?.yearEndDate)}
            onChange={(e) => onChange({ ...state, yearEndDate: e.target.value })}
          />
          <FieldError message={errors?.yearEndDate} />
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
        <FieldError message={errors?.currentTermSequence} />
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

        {/* Name the connection the owner cannot otherwise see: it is the year
            dates they just edited that put these rows out of range. */}
        {termsInvalid && (
          <p className="mt-2 text-sm text-destructive">
            Your term dates need to fit inside the academic year above. Adjust the highlighted
            dates below, or change the year&apos;s start and end dates back.
          </p>
        )}

        {showTerms && (
          <div className="mt-3 space-y-3">
            {state.terms.map((t, i) => {
              const termError = errors?.terms[i];
              return (
                <div
                  key={t.sequence}
                  className={
                    termError?.row
                      ? "rounded-md border border-destructive/40 bg-destructive/5 p-3"
                      : undefined
                  }
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Term {t.sequence} name</span>
                      <input
                        className={inputClasses(Boolean(termError?.name))}
                        value={t.name}
                        disabled={disabled}
                        aria-invalid={Boolean(termError?.name)}
                        onChange={(e) => setTerm(i, { name: e.target.value })}
                      />
                      <FieldError message={termError?.name} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Starts</span>
                      <input
                        type="date"
                        className={inputClasses(Boolean(termError?.startDate || termError?.row))}
                        value={t.startDate}
                        disabled={disabled}
                        aria-invalid={Boolean(termError?.startDate || termError?.row)}
                        onChange={(e) => setTerm(i, { startDate: e.target.value })}
                      />
                      <FieldError message={termError?.startDate} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Ends</span>
                      <input
                        type="date"
                        className={inputClasses(Boolean(termError?.endDate || termError?.row))}
                        value={t.endDate}
                        disabled={disabled}
                        aria-invalid={Boolean(termError?.endDate || termError?.row)}
                        onChange={(e) => setTerm(i, { endDate: e.target.value })}
                      />
                      <FieldError message={termError?.endDate} />
                    </label>
                  </div>
                  {termError?.row && (
                    <p className="mt-2 text-xs text-destructive">{termError.row}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
