"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  onboardingStep3Schema,
  type OnboardingStep3Input,
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
import { track } from "@/lib/observability/events";
import { advanceStep3 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

// Dynamic invite list. The "Skip for now" button submits with an empty array
// — same wire format as the form with rows, so the user can mix-and-match
// without us needing two different submission paths.
//
// First/last name are collected here but not stored on the Invitation row
// yet (no columns for them). Slice 7 will pick them up from the audit
// metadata when wiring email send. Captured in deferred.md.
export function Step3InvitesForm() {
  const { setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OnboardingStep3Input>({
    resolver: zodResolver(onboardingStep3Schema),
    defaultValues: { invites: [] },
    mode: "onSubmit",
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "invites",
  });

  async function submit(values: OnboardingStep3Input) {
    setSubmitting(true);
    try {
      const res = await advanceStep3(values);
      setSchool(res.school);
      track("onboarding_step_completed", { schoolId: res.school.id, step: 3 });
      router.replace("/onboarding/4");
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

  const onSubmit = form.handleSubmit(submit);
  const onSkip = () => submit({ invites: [] });

  // Top-level error message (e.g. "duplicate email in payload") that targets
  // the array itself rather than a specific field.
  const invitesError =
    form.formState.errors.invites && !Array.isArray(form.formState.errors.invites)
      ? form.formState.errors.invites.message
      : undefined;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <OnboardingProgress currentStep={3} />
        <div className="mt-4">
          <CardTitle>Invite admins</CardTitle>
          <CardDescription>
            Optional — add additional admins now, or skip and do it later from Settings.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {fields.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No invitations yet. Click <strong>Add invite</strong> to add one,
              or <strong>Skip for now</strong> to continue.
            </p>
          )}
          {fields.map((field, index) => {
            const rowErrors = Array.isArray(form.formState.errors.invites)
              ? form.formState.errors.invites[index]
              : undefined;
            return (
              <div
                key={field.id}
                className="flex flex-col gap-2 rounded-md border p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Invite {index + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                    aria-label={`Remove invite ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`invites.${index}.email`}>Email</Label>
                  <Input
                    id={`invites.${index}.email`}
                    type="email"
                    {...form.register(`invites.${index}.email` as const)}
                    aria-invalid={Boolean(rowErrors?.email)}
                  />
                  {rowErrors?.email && (
                    <p className="text-sm text-destructive">{rowErrors.email.message}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor={`invites.${index}.firstName`}>First name (optional)</Label>
                    <Input
                      id={`invites.${index}.firstName`}
                      {...form.register(`invites.${index}.firstName` as const)}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <Label htmlFor={`invites.${index}.lastName`}>Last name (optional)</Label>
                    <Input
                      id={`invites.${index}.lastName`}
                      {...form.register(`invites.${index}.lastName` as const)}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {invitesError && <p className="text-sm text-destructive">{invitesError}</p>}

          <Button
            type="button"
            variant="outline"
            onClick={() => append({ email: "", firstName: "", lastName: "" })}
            className="self-start"
          >
            <Plus className="mr-1 h-4 w-4" />
            Add invite
          </Button>

          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onSkip}
              disabled={submitting}
              className="flex-1"
            >
              Skip for now
            </Button>
            <Button type="submit" disabled={submitting || fields.length === 0} className="flex-1">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Saving…" : `Send ${fields.length || ""} invite${fields.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
