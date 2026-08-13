"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LogoUpload } from "@/components/school/logo-upload";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { track } from "@/lib/observability/events";
import { advanceStep2 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Slice 6 branding form. Logo is a real upload (LogoUpload, resolved
// 2026-07-26 — see step2-branding.dto.ts's header comment for the full
// history of the raw-URL-text-field gap this replaced); it uploads
// immediately on file selection, independent of this form's own Continue
// submit, same as the settings/school page's copy of the same widget.
//
// The primary-colour input was REMOVED from this step (2026-08-12). It was
// a raw hex text field ("#1A2B3C") — the single most confusing input in the
// wizard, asking a school owner to hand-type a notation they have no reason
// to know, for a value that doesn't yet drive any theming anywhere. It
// remains on the Settings > School page for anyone who wants it, and the
// step-2 payload still carries the field (onboardingStep2Schema is shared
// with PATCH /schools/me), so nothing on the API side changed — this form
// simply always submits it as absent.
//
// With the colour gone, react-hook-form/zodResolver went with it: there is
// no field left to register, validate, or show an error for. A plain submit
// handler posting `{}` is the whole form now.
export function Step2BrandingForm() {
  const { setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await advanceStep2({});
      setSchool(res.school);
      track("onboarding_step_completed", { schoolId: res.school.id, step: 2 });
      router.replace("/onboarding/3");
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
    <Card className="w-full max-w-md">
      <CardHeader>
        <OnboardingProgress currentStep={2} />
        <div className="mt-4">
          <CardTitle>Your school logo</CardTitle>
          <CardDescription>
            Optional — it appears on report cards and invoices. You can add or
            change it any time from Settings.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label>Logo (optional)</Label>
            <LogoUpload />
          </div>
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
