"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { forgotPasswordSchema, type ForgotPasswordInput } from "@school-kit/types";

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
import { forgotPasswordRequest } from "@/lib/auth/auth-api";

// No error branch on submit — the API always returns the same generic
// 200 response regardless of whether the email matched an account (account-
// enumeration guard, see AuthService.forgotPassword). A network failure is
// the only thing that can actually throw here, so the only UI states are
// "form" and "sent".
export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    setNetworkError(null);
    try {
      await forgotPasswordRequest(values);
      setSent(true);
    } catch {
      setNetworkError("Could not reach the server. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  });

  if (sent) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>
            If an account exists for that email, we&apos;ve sent instructions to reset your
            password. The link expires in 1 hour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm text-muted-foreground underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Forgot your password?</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a link to reset it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              {...form.register("email")}
              aria-invalid={Boolean(form.formState.errors.email)}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>

          {networkError && <p className="text-sm text-destructive">{networkError}</p>}

          <Button type="submit" disabled={submitting} className="mt-2">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
