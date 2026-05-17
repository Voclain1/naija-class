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
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { advanceStep2 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Slice 6 branding form. logoUrl is a plain text input by spec — real R2
// upload is Phase 2 (see docs/deferred.md). primaryColor is a hex string;
// the colour doesn't yet drive any theming, but capturing it now means
// Phase 2 only has to wire the consumer side.
//
// Both fields optional — the user can click Continue with an empty form.
// We coerce empty strings to undefined before submitting so the Zod
// `.optional()` is satisfied instead of failing the URL/regex checks on "".
export function Step2BrandingForm() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OnboardingStep2Input>({
    resolver: zodResolver(onboardingStep2Schema),
    defaultValues: {
      logoUrl: school?.logoUrl ?? undefined,
      primaryColor: school?.primaryColor ?? undefined,
    },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const payload: OnboardingStep2Input = {
        logoUrl: values.logoUrl?.trim() || undefined,
        primaryColor: values.primaryColor?.trim() || undefined,
      };
      const res = await advanceStep2(payload);
      setSchool(res.school);
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
            <Label htmlFor="logoUrl">Logo URL (optional)</Label>
            <Input
              id="logoUrl"
              type="url"
              placeholder="https://example.com/logo.png"
              {...form.register("logoUrl")}
              aria-invalid={Boolean(form.formState.errors.logoUrl)}
            />
            {form.formState.errors.logoUrl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.logoUrl.message}
              </p>
            )}
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
