"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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

// Final screen. Clicking "Go to dashboard" POSTs step 5 (which flips status
// to ACTIVE), updates the auth context with the now-ACTIVE school, then
// router.replaces to /dashboard. RequireAuth on the (admin) layout will see
// status===ACTIVE and render the dashboard instead of bouncing back.
export function Step5Success() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Fire onboarding_completed on mount — landing on step 5 *is* the
  // completion signal regardless of whether the user clicks the dashboard
  // button. $insert_id keys the event by schoolId so refreshes don't
  // double-count it in PostHog. React 19 StrictMode double-invokes effects
  // in dev; the same $insert_id makes that idempotent too.
  useEffect(() => {
    if (!school) return;
    track(
      "onboarding_completed",
      { schoolId: school.id },
      { $insert_id: `onboarding_completed_${school.id}` },
    );
  }, [school]);

  async function finish() {
    setSubmitting(true);
    try {
      const res = await advanceStep5({});
      setSchool(res.school);
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Could not reach the server. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader>
        <OnboardingProgress currentStep={5} />
        <div className="mt-4 flex flex-col items-center gap-2">
          <CheckCircle2 className="h-10 w-10 text-primary" />
          <CardTitle>You&apos;re all set</CardTitle>
          <CardDescription>
            {school?.name ? `Welcome, ${school.name}.` : "Welcome."} Your school is ready.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button onClick={finish} disabled={submitting} className="w-full">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? "Finalising…" : "Go to dashboard"}
        </Button>
      </CardContent>
    </Card>
  );
}
