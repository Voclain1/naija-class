"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { apiErrorLines } from "@/lib/errors/api-error-lines";
import { track } from "@/lib/observability/events";
import { advanceStep5 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Final step. Was a pure success screen whose button only flipped status to
// ACTIVE; as of 2026-08-21 it also collects the school's first academic year
// and its three terms, because without them a school cannot enroll, invoice,
// or mark a register (#198 — a production census found 36 of 42 real schools
// stuck exactly there).
//
// NOT SKIPPABLE, deliberately. A skip returns the school to the broken state
// this step exists to close, and it would do so invisibly. The cost of not
// skipping is low precisely because every field is pre-filled — the owner can
// read the defaults and press the button.
//
// The component keeps its filename and export so no route or import moves;
// the step number is unchanged too (see step5-complete.dto.ts for why the
// calendar rides on step 5 rather than becoming a new step 6).
export function Step5Success() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorLines, setErrorLines] = useState<string[]>([]);

  // Computed once on mount, not on every render — proposeAcademicCalendar()
  // reads `new Date()`, and a re-render mid-form must not shuffle the dates
  // out from under someone who is editing them.
  const [initial] = useState(() => initialCalendarState());
  const [calendar, setCalendar] = useState(initial.state);

  // Whether the owner has tried to submit yet. Errors stay hidden until then,
  // so the form does not open shouting at a set of defaults that are valid.
  const [showValidation, setShowValidation] = useState(false);

  // The server's own schema, run against the current state on every render.
  // Cheap (three date comparisons), and always in step with what the user has
  // just typed.
  const fieldErrors = validateCalendarState(calendar);
  const invalid = hasCalendarErrors(fieldErrors);

  // Fire onboarding_completed on mount — landing on step 5 *is* the
  // completion signal regardless of whether the user clicks the button.
  // $insert_id keys the event by schoolId so refreshes don't double-count it
  // in PostHog. React 19 StrictMode double-invokes effects in dev; the same
  // $insert_id makes that idempotent too.
  useEffect(() => {
    if (!school) return;
    track(
      "onboarding_completed",
      { schoolId: school.id },
      { $insert_id: `onboarding_completed_${school.id}` },
    );
  }, [school]);

  async function finish(e: React.FormEvent) {
    e.preventDefault();
    setShowValidation(true);

    // Stop here rather than spending a round-trip to be told the same thing.
    // The messages are the server's own, so this cannot disagree with it.
    if (invalid) {
      setErrorLines(fieldErrors.all);
      return;
    }

    setSubmitting(true);
    setErrorLines([]);
    try {
      const res = await advanceStep5({ calendar: toCalendarInput(calendar) });
      setSchool(res.school);
      router.replace("/dashboard");
    } catch (err) {
      // Server-side validation (overlapping terms, terms outside the year) is
      // the authority. Read its details.issues[] — `err.message` is the
      // constant "Invalid request payload", which is what left a real school
      // stuck here on 2026-09-11 with nothing to act on.
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
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <OnboardingProgress currentStep={5} />
        <div className="mt-4 flex flex-col gap-2">
          <CardTitle>Set up your school year</CardTitle>
          <CardDescription>
            {school?.name ? `Almost there, ${school.name}. ` : "Almost there. "}
            We&apos;ve filled in a typical Nigerian school year — change anything that doesn&apos;t
            match yours.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={finish} className="space-y-6">
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

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Finishing setup…" : "Finish setup"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
