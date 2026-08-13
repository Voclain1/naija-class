"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { signupOwnerSchema, type SignupOwnerInput } from "@school-kit/types";

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

// School owner signup. Calls POST /auth/signup-owner via auth-provider's
// signup(), which stores the bearer, fetches /auth/me, fires the
// signup_completed PostHog event, and identifies the user. We then push
// the user into the onboarding wizard at step 1.
export function SignupForm() {
  const { signup } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<SignupOwnerInput>({
    resolver: zodResolver(signupOwnerSchema),
    defaultValues: {
      schoolName: "",
      // schoolSlug is deliberately absent — the API derives it from
      // schoolName (see signup-owner.dto.ts). Sending "" would fail the
      // slug regex, so it must be omitted, not blanked.
      ownerFirstName: "",
      ownerLastName: "",
      ownerEmail: "",
      ownerPhone: "",
      password: "",
      // react-hook-form's default value type cannot satisfy z.literal(true);
      // we coerce to the literal type and set the value via the checkbox.
      ndprConsent: false as unknown as true,
    },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      await signup(values);
      router.replace("/onboarding/1");
    } catch (error) {
      if (error instanceof ApiError) {
        // EMAIL_TAKEN / PHONE_TAKEN — map to the offending field so the
        // user can fix it without re-typing.
        //
        // SCHOOL_SLUG_TAKEN is deliberately NOT handled here any more: this
        // form doesn't collect a slug, so there's no field to attach the
        // error to and nothing the user could do about it. The server
        // resolves collisions itself by suffixing (bright-star-academy-2),
        // so the code should be unreachable from this form; if it somehow
        // fires, it falls through to the generic toast below rather than
        // silently doing nothing.
        if (error.code === "EMAIL_TAKEN") {
          form.setError("ownerEmail", {
            type: "manual",
            message: "An account already exists for this email.",
          });
        } else if (error.code === "PHONE_TAKEN") {
          form.setError("ownerPhone", {
            type: "manual",
            message: "An account already exists for this phone number.",
          });
        } else {
          toast.error(error.message);
        }
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
        <CardTitle>Create your school</CardTitle>
        <CardDescription>
          Set up your schoolkit account. Onboarding takes about five minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            label="School name"
            id="schoolName"
            register={form.register("schoolName")}
            error={form.formState.errors.schoolName?.message}
            autoFocus
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <Field
                label="First name"
                id="ownerFirstName"
                register={form.register("ownerFirstName")}
                error={form.formState.errors.ownerFirstName?.message}
                autoComplete="given-name"
              />
            </div>
            <div className="flex-1">
              <Field
                label="Last name"
                id="ownerLastName"
                register={form.register("ownerLastName")}
                error={form.formState.errors.ownerLastName?.message}
                autoComplete="family-name"
              />
            </div>
          </div>
          <Field
            label="Email"
            id="ownerEmail"
            type="email"
            register={form.register("ownerEmail")}
            error={form.formState.errors.ownerEmail?.message}
            autoComplete="email"
          />
          <Field
            label="Phone"
            id="ownerPhone"
            type="tel"
            register={form.register("ownerPhone")}
            error={form.formState.errors.ownerPhone?.message}
            autoComplete="tel"
            description="e.g. 08012345678 or +2348012345678."
          />
          <Field
            label="Password"
            id="password"
            type="password"
            register={form.register("password")}
            error={form.formState.errors.password?.message}
            autoComplete="new-password"
            description="At least 8 characters, with an uppercase letter, a lowercase letter, a digit, and a symbol (e.g. !)."
          />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              {...form.register("ndprConsent")}
              aria-invalid={Boolean(form.formState.errors.ndprConsent)}
            />
            <span>
              I accept the data handling terms and confirm I&apos;m authorised
              to create an account for this school under NDPR.
            </span>
          </label>
          {form.formState.errors.ndprConsent && (
            <p className="text-sm text-destructive">
              {form.formState.errors.ndprConsent.message}
            </p>
          )}

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Creating…" : "Create school"}
          </Button>

          <p className="mt-2 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="underline">
              Sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  id,
  type = "text",
  register,
  error,
  description,
  autoComplete,
  autoFocus,
}: {
  label: string;
  id: string;
  type?: string;
  register: ReturnType<ReturnType<typeof useForm>["register"]>;
  error?: string;
  description?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        {...register}
        aria-invalid={Boolean(error)}
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
