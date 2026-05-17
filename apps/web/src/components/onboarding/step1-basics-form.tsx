"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  onboardingStep1Schema,
  type OnboardingStep1Input,
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
import { advanceStep1 } from "@/lib/onboarding/onboarding-api";

import { OnboardingProgress } from "./progress-indicator";

export function Step1BasicsForm() {
  const { school, setSchool } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OnboardingStep1Input>({
    resolver: zodResolver(onboardingStep1Schema),
    // Pre-fill from whatever the school currently has. After signup the name
    // is whatever the owner typed; the rest are blank. After a step 1
    // revisit (the user clicking back from step 3), the form shows the
    // previously-saved values so editing is a one-field touch-up.
    defaultValues: {
      name: school?.name ?? "",
      motto: school?.motto ?? undefined,
      address: school?.address ?? undefined,
      phone: school?.phone ?? "",
      email: school?.email ?? "",
    },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const res = await advanceStep1(values);
      setSchool(res.school);
      track("onboarding_step_completed", { schoolId: res.school.id, step: 1 });
      router.replace("/onboarding/2");
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
        <OnboardingProgress currentStep={1} />
        <div className="mt-4">
          <CardTitle>School basics</CardTitle>
          <CardDescription>The essentials — easy to change later.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label="School name"
            id="name"
            register={form.register("name")}
            error={form.formState.errors.name?.message}
          />
          <Field
            label="Motto (optional)"
            id="motto"
            register={form.register("motto")}
            error={form.formState.errors.motto?.message}
          />
          <Field
            label="Address (optional)"
            id="address"
            register={form.register("address")}
            error={form.formState.errors.address?.message}
          />
          <Field
            label="Phone"
            id="phone"
            type="tel"
            register={form.register("phone")}
            error={form.formState.errors.phone?.message}
          />
          <Field
            label="Email"
            id="email"
            type="email"
            register={form.register("email")}
            error={form.formState.errors.email?.message}
          />
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Saving…" : "Continue"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// Small per-field wrapper. Kept local to avoid premature abstraction — used
// only by the wizard's step forms, where every form has the same vertical
// stack of (label, input, error message). If a third caller appears, move
// to /components/ui/.
function Field({
  label,
  id,
  type = "text",
  register,
  error,
}: {
  label: string;
  id: string;
  type?: string;
  register: ReturnType<ReturnType<typeof useForm>["register"]>;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} {...register} aria-invalid={Boolean(error)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
