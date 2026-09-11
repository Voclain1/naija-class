"use client";

import { CalendarDays, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CalendarFormFields,
  hasCalendarErrors,
  initialCalendarState,
  toCalendarInput,
  validateCalendarState,
} from "@/components/academic-calendar/calendar-form-fields";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import {
  createAcademicCalendar,
  getCalendarStatus,
} from "@/lib/academic-calendar/academic-calendar-api";
import { useAuth } from "@/lib/auth/use-auth";
import { apiErrorLines } from "@/lib/errors/api-error-lines";

// The recovery surface for schools that completed onboarding BEFORE the
// calendar step existed. The 2026-08-21 production census found 23 of them
// against 13 still in the wizard, so this is not a long-tail case — it is the
// larger half of the affected population, and the plan-first says neither
// surface gets deprioritised.
//
// WHY A PROMPT AND NOT A BACKFILL. The earlier backfill-school-defaults.ts was
// safe because the 14 standard class levels are universally correct — writing
// them into a school that lacked them could not be wrong. Term dates are
// school-specific judgement, and wrong ones silently mis-attribute attendance
// and expenses. So these schools get asked, exactly like new ones.
// See docs/modules/academic-calendar-bootstrap.md §4.
//
// Renders nothing at all for a healthy school, so it is safe to mount high in
// the admin shell.
export function CalendarSetupPrompt() {
  const { school, roles } = useAuth();
  const [needsCalendar, setNeedsCalendar] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[]>([]);

  const [initial] = useState(() => initialCalendarState());
  const [calendar, setCalendar] = useState(initial.state);

  // Same validation mirror as the wizard's step 5 — this surface shares the
  // form, the schema and therefore the same failure mode. The 2026-08-21
  // census put 23 already-active schools here against 13 in the wizard, so
  // fixing only the wizard would have left the larger half of the affected
  // population on the generic error.
  const [showValidation, setShowValidation] = useState(false);
  const fieldErrors = validateCalendarState(calendar);
  const invalid = hasCalendarErrors(fieldErrors);

  // Only owner/admin can create a calendar (the API enforces it). A bursar or
  // teacher blocked by the missing calendar still sees the banner — knowing
  // WHY the product is inert is worth more than hiding it — but is told who
  // can fix it rather than shown a form that would 403.
  const canFix = roles.some((r) => r.key === "owner" || r.key === "admin");

  useEffect(() => {
    // A school still in ONBOARDING gets the wizard's step 5 instead; showing
    // both would be two prompts for one thing.
    if (!school || school.status !== "ACTIVE") return;
    let cancelled = false;
    getCalendarStatus()
      .then((res) => {
        if (!cancelled) setNeedsCalendar(res.needsCalendar);
      })
      .catch(() => {
        // Never let a failed status check block the page it sits on. A school
        // that needs the prompt will get it on the next load.
      });
    return () => {
      cancelled = true;
    };
  }, [school]);

  if (!needsCalendar) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);

    if (invalid) {
      setErrorLines(fieldErrors.all);
      return;
    }

    setSubmitting(true);
    setErrorLines([]);
    try {
      await createAcademicCalendar(toCalendarInput(calendar));
      setNeedsCalendar(false);
      setOpen(false);
      toast.success("School year set up. You can now enroll students and issue invoices.");
      // A full reload rather than local state: every page behind this banner
      // (rosters, finance, attendance) fetched its data against a school that
      // had no current term, so their caches are all stale-empty.
      window.location.reload();
    } catch (err) {
      // details.issues[] carries the actionable sentence; err.message is the
      // constant "Invalid request payload". See lib/errors/api-error-lines.ts.
      const lines = apiErrorLines(
        err instanceof ApiError ? err : null,
        "Could not reach the server. Try again in a moment.",
      );
      setErrorLines(lines);
      toast.error(lines[0]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 rounded-md border border-secondary/50 bg-secondary/10 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Your school year hasn&apos;t been set up yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Until it is, you can&apos;t enroll students, issue invoices, or mark attendance.
              {canFix ? " It takes about a minute." : " Ask your school owner or an admin to set it up."}
            </p>
          </div>
        </div>
        {canFix && !open && (
          <Button onClick={() => setOpen(true)} size="sm">
            Set up school year
          </Button>
        )}
      </div>

      {canFix && open && (
        <form onSubmit={submit} className="mt-4 space-y-5 border-t border-border pt-4">
          <CalendarFormFields
            state={calendar}
            onChange={setCalendar}
            currentTermContainsToday={initial.currentTermContainsToday}
            disabled={submitting}
            errors={showValidation ? fieldErrors : undefined}
          />

          {errorLines.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {errorLines.length === 1 ? (
                errorLines[0]
              ) : (
                <ul className="list-disc space-y-1 pl-5">
                  {errorLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Saving…" : "Save school year"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
