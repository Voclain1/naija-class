"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { loginSchema, type LoginInput } from "@school-kit/types";

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

// Two-step login: credentials → (if 2FA enabled) TOTP code.
type FormStep =
  | { kind: "credentials" }
  | { kind: "totp"; challengeToken: string };

const totpStepSchema = z.object({
  code: z
    .string()
    .length(6, "Must be exactly 6 digits")
    .regex(/^\d{6}$/, "Digits only"),
});
type TotpStepInput = z.infer<typeof totpStepSchema>;

export function LoginForm() {
  const { login, loginWithChallenge } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<FormStep>({ kind: "credentials" });

  const credForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const totpForm = useForm<TotpStepInput>({
    resolver: zodResolver(totpStepSchema),
    defaultValues: { code: "" },
    mode: "onSubmit",
  });

  const onCredSubmit = credForm.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const result = await login(values);
      if (result?.requiresTwoFactor) {
        setStep({ kind: "totp", challengeToken: result.challengeToken });
      } else {
        router.replace("/dashboard");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        credForm.setError("password", {
          type: "manual",
          message: "Email or password is incorrect.",
        });
      } else if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Could not reach the server. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  });

  const onTotpSubmit = totpForm.handleSubmit(async (values) => {
    if (step.kind !== "totp") return;
    setSubmitting(true);
    try {
      await loginWithChallenge({ challengeToken: step.challengeToken, code: values.code });
      router.replace("/dashboard");
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_2FA_CODE") {
        totpForm.setError("code", {
          type: "manual",
          message: "Incorrect code. Try again.",
        });
      } else if (error instanceof ApiError && error.code === "INVALID_2FA_CHALLENGE") {
        // Challenge token expired (5-min TTL) — restart from credentials.
        setStep({ kind: "credentials" });
        totpForm.reset();
        toast.error("Session expired. Please sign in again.");
      } else if (error instanceof ApiError) {
        toast.error(error.message);
      } else {
        toast.error("Could not verify code. Try again in a moment.");
      }
    } finally {
      setSubmitting(false);
    }
  });

  if (step.kind === "totp") {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onTotpSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="code">Verification code</Label>
              <Input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                autoFocus
                {...totpForm.register("code")}
                aria-invalid={Boolean(totpForm.formState.errors.code)}
              />
              {totpForm.formState.errors.code && (
                <p className="text-sm text-destructive">
                  {totpForm.formState.errors.code.message}
                </p>
              )}
            </div>
            <Button type="submit" disabled={submitting} className="mt-2">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Verifying…" : "Verify"}
            </Button>
            <button
              type="button"
              className="mt-1 text-center text-sm text-muted-foreground underline"
              onClick={() => {
                setStep({ kind: "credentials" });
                totpForm.reset();
              }}
            >
              Back to sign in
            </button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Use your school owner or admin credentials.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onCredSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              {...credForm.register("email")}
              aria-invalid={Boolean(credForm.formState.errors.email)}
            />
            {credForm.formState.errors.email && (
              <p className="text-sm text-destructive">
                {credForm.formState.errors.email.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...credForm.register("password")}
              aria-invalid={Boolean(credForm.formState.errors.password)}
            />
            {credForm.formState.errors.password && (
              <p className="text-sm text-destructive">
                {credForm.formState.errors.password.message}
              </p>
            )}
          </div>
          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            New school?{" "}
            <Link href="/signup" className="underline">
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
