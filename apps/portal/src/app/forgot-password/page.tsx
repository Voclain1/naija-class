"use client";

// Guardian portal — request a password reset (F-06).
//
// PRIVACY IS THE DESIGN CONSTRAINT HERE. The API returns an identical
// response for a real account, an unknown address, and a guardian who was
// invited but never set a password. This page must not undo that: it shows
// the SAME confirmation whatever happens, and deliberately does not offer
// "no account found" as a state, because it has no way to know and no right
// to say.
//
// Note the second-order leak this also avoids: if the confirmation copy said
// "check your inbox" only when an account existed, then a school's parent
// list could be enumerated one address at a time by anyone with the login
// page open.

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  guardianForgotPasswordSchema,
  type GuardianForgotPasswordInput,
} from "@school-kit/types";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export default function ForgotPasswordPage() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const form = useForm<GuardianForgotPasswordInput>({
    resolver: zodResolver(guardianForgotPasswordSchema),
    defaultValues: { email: "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/portal/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        // Only genuine transport/rate-limit failures land here — the API
        // returns 200 for every account-existence outcome by design. Showing
        // the real message matters for the one case a parent can act on:
        // "too many attempts, try again in 15 minutes".
        const body: unknown = await res.json().catch(() => null);
        const message =
          body !== null && typeof body === "object" && "error" in body
            ? ((body as { error?: { message?: string } }).error?.message ??
                "Something went wrong. Try again.")
            : "Could not reach the server. Try again in a moment.";
        setState({ kind: "error", message });
        return;
      }

      setState({ kind: "sent" });
    } catch {
      setState({
        kind: "error",
        message: "Could not reach the server. Try again in a moment.",
      });
    }
  });

  if (state.kind === "sent") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Check your email</h1>
          {/* Says nothing about whether an account exists. "If an account
              exists" is doing real work in this sentence, not hedging. */}
          <p className="text-sm text-muted-foreground">
            If an account exists for that email, we have sent a link to reset
            your password. The link expires in 1 hour and can be used once.
          </p>
          <p className="text-sm text-muted-foreground">
            Nothing arrived? Check your spam folder, or contact your school.
          </p>
          <Link
            href="/login"
            className="text-sm text-muted-foreground underline hover:text-foreground"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  const submitting = state.kind === "submitting";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">SchoolKit</h1>
        <p className="text-sm text-muted-foreground">Parent Portal</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Forgot your password?</h2>
          <p className="text-sm text-muted-foreground">
            Enter the email address your school has for you and we will send a
            link to set a new password.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-invalid={Boolean(form.formState.errors.email)}
            aria-describedby={form.formState.errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p id="email-error" className="text-sm text-destructive">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        {state.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>

        <p className="text-center text-sm">
          <Link
            href="/login"
            className="text-muted-foreground underline hover:text-foreground"
          >
            Back to sign in
          </Link>
        </p>
      </form>
    </main>
  );
}
