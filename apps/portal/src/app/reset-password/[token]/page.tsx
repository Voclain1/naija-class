"use client";

// Guardian portal — set a new password from a reset link (F-06).
//
// The route shape mirrors apps/web's staff equivalent
// (app/(auth)/reset-password/[token]) and the portal's own
// invitations/[token]: the token is a PATH segment, not a query parameter.
// That is deliberate and worth stating — query strings are the part of a URL
// most likely to end up in a Referer header, an analytics payload or a
// server access log.
//
// This page never displays who the account belongs to. It cannot: the API's
// resolver deliberately returns no name and no email, because the endpoint is
// public and takes an attacker-supplied token, and echoing an identity back
// would turn a guessed or leaked token into a disclosure of whose account it
// opens. "Your password" is enough — the person holding the link knows who
// they are.

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import {
  guardianResetPasswordSchema,
  type GuardianResetPasswordInput,
} from "@school-kit/types";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done" }
  | { kind: "error"; message: string };

// The form collects a password and a confirmation; the token comes from the
// URL, so it is omitted here and added at submit time.
const formSchema = guardianResetPasswordSchema
  .omit({ token: true })
  .extend({ confirmPassword: guardianResetPasswordSchema.shape.password })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type FormValues = { password: string; confirmPassword: string };

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setState({ kind: "submitting" });
    try {
      const payload: GuardianResetPasswordInput = {
        token,
        password: values.password,
      };
      const res = await fetch("/api/portal/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // The API distinguishes PASSWORD_RESET_ALREADY_USED from
        // PASSWORD_RESET_EXPIRED and writes real sentences for both —
        // surfacing them verbatim is the whole reason the resolver returns
        // used_at and expires_at separately instead of collapsing to
        // "invalid".
        const body: unknown = await res.json().catch(() => null);
        const message =
          body !== null && typeof body === "object" && "error" in body
            ? ((body as { error?: { message?: string } }).error?.message ??
                "This reset link is not valid.")
            : "Could not reach the server. Try again in a moment.";
        setState({ kind: "error", message });
        return;
      }

      setState({ kind: "done" });
    } catch {
      setState({
        kind: "error",
        message: "Could not reach the server. Try again in a moment.",
      });
    }
  });

  if (state.kind === "done") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 text-center shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">Password updated</h1>
          {/* No auto-login, matching the staff convention: recovery re-enters
              the normal, rate-limited login path. Saying that signing in
              elsewhere has ended is not a technicality — it is how a parent
              confirms an intruder was pushed out. */}
          <p className="text-sm text-muted-foreground">
            You can now sign in with your new password. For your security, you
            have been signed out everywhere else.
          </p>
          <Link
            href="/login"
            className="h-10 rounded-md bg-primary px-4 text-sm font-medium leading-10 text-primary-foreground"
          >
            Go to sign in
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
        method="post"
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Set a new password</h2>
          <p className="text-sm text-muted-foreground">
            Choose a password you have not used before.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            New password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              autoFocus
              className="h-10 w-full rounded-md border border-input bg-background px-3 pr-16 text-sm"
              aria-invalid={Boolean(form.formState.errors.password)}
              aria-describedby="password-rules"
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-controls="password"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {/* Rules stated UP FRONT rather than only as a validation failure —
              a parent should not have to discover the policy by breaking it
              four times. */}
          <p id="password-rules" className="text-xs text-muted-foreground">
            At least 8 characters, with an uppercase letter, a lowercase
            letter, a number and a symbol.
          </p>
          {form.formState.errors.password && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            // Follows the Show/Hide toggle above: revealing one field and not
            // the other makes checking a typo impossible, which is the only
            // reason to reveal at all.
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-invalid={Boolean(form.formState.errors.confirmPassword)}
            {...form.register("confirmPassword")}
          />
          {form.formState.errors.confirmPassword && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        {state.kind === "error" && (
          <div role="alert" className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{state.message}</p>
            {/* A dead link is a dead end unless there is a way back to
                requesting a fresh one. */}
            <Link
              href="/forgot-password"
              className="text-sm text-muted-foreground underline hover:text-foreground"
            >
              Request a new reset link
            </Link>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Set new password"}
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
