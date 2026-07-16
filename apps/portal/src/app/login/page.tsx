"use client";

// Phase 4 / Slice 2 — real submit handler replaces slice 1's static shell.
// POSTs to this app's own /api/portal/login route (never the NestJS API
// directly — see the proxy route's header comment for why), which sets the
// httpOnly sk_portal_session cookie and strips the raw token before this
// component ever sees the response body.
//
// No dashboard exists yet (that's slice 4's "parent view" territory) — on
// success this shows an inline confirmation and lets the visitor navigate to
// "/", which now checks for the session cookie server-side (see
// app/page.tsx) instead of unconditionally bouncing back to /login.

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { guardianLoginSchema, type GuardianLoginInput } from "@school-kit/types";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export default function LoginPage() {
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  const form = useForm<GuardianLoginInput>({
    resolver: zodResolver(guardianLoginSchema),
    defaultValues: { email: "", password: "" },
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          body !== null && typeof body === "object" && "error" in body
            ? // ErrorBody shape: { error: { code, message } }
              ((body as { error?: { message?: string } }).error?.message ??
                "Something went wrong. Try again.")
            : "Could not reach the server. Try again in a moment.";
        setState({ kind: "error", message });
        return;
      }

      setState({ kind: "success" });
    } catch {
      setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
    }
  });

  if (state.kind === "success") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re signed in</h1>
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="underline">
              Continue
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">School Kit</h1>
        <p className="text-sm text-muted-foreground">Parent Portal</p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-invalid={Boolean(form.formState.errors.email)}
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        {state.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}

        <button
          type="submit"
          disabled={state.kind === "submitting"}
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === "submitting" ? "Signing in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
