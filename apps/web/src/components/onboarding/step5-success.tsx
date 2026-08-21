"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  CalendarFormFields,
  initialCalendarState,
  toCalendarInput,
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
  const [error, setError] = useState<string | null>(null);

  // Computed once on mount, not on every render — proposeAcademicCalendar()
  // reads `new Date()`, and a re-render mid-form must not shuffle the dates
  // out from under someone who is editing them.
  const [initial] = useState(() => initialCalendarState());
  const [calendar, setCalendar] = useState(initial.state);

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
    setSubmitting(true);
    setError(null);
    try {
      const res = await advanceStep5({ calendar: toCalendarInput(calendar) });
      setSchool(res.school);
      router.replace("/dashboard");
    } catch (err) {
      // Server-side validation (overlapping terms, terms outside the year) is
      // the authority; surface its message rather than a generic failure, so
      // a date problem is actionable instead of mysterious.
      const message =
        err instanceof ApiError
          ? err.message
          : "Could not reach the server. Try again in a moment.";
      setError(message);
      toast.error(message);
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
          />

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
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
