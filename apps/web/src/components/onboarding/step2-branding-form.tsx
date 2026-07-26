"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  onboardingStep2Schema,
  type OnboardingStep2Input,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogoUpload } from "@/components/school/logo-upload";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { track } from "@/lib/observability/events";
import { advanceStep2 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Slice 6 branding form. Logo is now a real upload (LogoUpload, resolved
// 2026-07-26 — see step2-branding.dto.ts's header comment for the full
// history of the raw-URL-text-field gap this replaced) — it uploads
// immediately on file selection, independent of this form's own Continue
// submit, same as the settings/school page's copy of the same widget.
// primaryColor is a hex string; the colour doesn't yet drive any theming,
// but capturing it now means a later slice only has to wire the consumer
// side.
//
// primaryColor is optional — the user can click Continue with an empty
// form. We coerce an empty string to undefined before submitting so the Zod
// `.optional()` is satisfied instead of failing the regex check on "".
export function Step2BrandingForm() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OnboardingStep2Input>({
    resolver: zodResolver(onboardingStep2Schema),
    defaultValues: {
      primaryColor: school?.primaryColor ?? undefined,
    },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const payload: OnboardingStep2Input = {
        primaryColor: values.primaryColor?.trim() || undefined,
      };
      const res = await advanceStep2(payload);
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
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <OnboardingProgress currentStep={2} />
        <div className="mt-4">
          <CardTitle>Branding</CardTitle>
          <CardDescription>
            Optional — you can add a logo and pick a colour later from Settings.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label>Logo (optional)</Label>
            <LogoUpload />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="primaryColor">Primary colour (optional)</Label>
            <Input
              id="primaryColor"
              type="text"
              placeholder="#1A2B3C"
              {...form.register("primaryColor")}
              aria-invalid={Boolean(form.formState.errors.primaryColor)}
            />
            {form.formState.errors.primaryColor && (
              <p className="text-sm text-destructive">
                {form.formState.errors.primaryColor.message}
              </p>
            )}
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
