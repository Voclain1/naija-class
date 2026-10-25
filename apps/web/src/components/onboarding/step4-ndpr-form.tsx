"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { SchoolConsentText } from "@/components/legal/legal-links";
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
import { track, trackOnboardingServerRejection } from "@/lib/observability/events";
import { advanceStep4 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Step 4 deliberately surfaces the policy summary in plain language rather
// than only re-asking for the checkbox the user already saw at signup. The
// API re-stamps ndprConsentAt to NOW() on this call, so the audit trail's
// "moment of consent" is the wizard click, not the form click weeks earlier.
export function Step4NdprForm() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consented) {
      setError("Tick the box to confirm.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await advanceStep4({ ndprConsent: true });
      setSchool(res.school);
      track("onboarding_step_completed", { schoolId: res.school.id, step: 4 });
      router.replace("/onboarding/5");
    } catch (apiError) {
      if (apiError instanceof ApiError) {
        trackOnboardingServerRejection(school?.id, 4, apiError);
        toast.error(apiError.message);
      } else {
        toast.error("Could not reach the server. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <OnboardingProgress currentStep={4} />
        <div className="mt-4">
          <CardTitle>Data protection consent</CardTitle>
          <CardDescription>
            Confirm you understand how SchoolKit handles your school&apos;s data.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
            <p className="font-medium">SchoolKit will:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Hold your students&apos;, parents&apos; and staff&apos;s details only to run SchoolKit for your school.</li>
              <li>Share them only with the providers that make SchoolKit work (hosting, payments, SMS, email), never for advertising.</li>
              <li>Never sell your data, and never let an AI provider train on it.</li>
              <li>Keep your school&apos;s data separate from every other school&apos;s, and tell you quickly if something goes wrong.</li>
            </ul>
            <p className="font-medium">Your school will:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Get each parent&apos;s consent before adding their child, as Nigerian data protection law requires. Settings → Data protection has a letter you can send.</li>
              <li>Get explicit consent before recording a child&apos;s health information.</li>
            </ul>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              aria-invalid={Boolean(error)}
            />
            <SchoolConsentText />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Saving…" : "Confirm and continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

