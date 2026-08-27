"use client";

// Guardian portal login.
//
// F-13: this page used to render a "You're signed in / Continue" screen on
// success. That interstitial was correct WHEN IT WAS WRITTEN — slice 2's own
// comment said "No dashboard exists yet (that's slice 4's parent view
// territory)", so there was genuinely nowhere to send anyone. Slice 4 shipped
// that dashboard (app/page.tsx, "Your children") and the interstitial was
// never removed, leaving every parent an extra click away from the thing they
// signed in for, on a screen that exists only to say the login worked.
//
// It is gone. A successful login now goes straight to the children list, or
// to whatever protected page the visitor was originally trying to reach.
//
// POSTs to this app's own /api/portal/login route (never the NestJS API
// directly — see the proxy route's header comment), which sets the httpOnly
// sk_portal_session cookie and strips the raw token before this component
// ever sees the response body.

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";

import { guardianLoginSchema, type GuardianLoginInput } from "@school-kit/types";

import {
  parseSessionEndReason,
  resolveNextPath,
  sessionEndNotice,
} from "@/lib/session-end";

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<SubmitState>({ kind: "idle" });
  const [showPassword, setShowPassword] = useState(false);

  // Why the parent is looking at this screen (F-10). Both parameters are
  // untrusted: parseSessionEndReason narrows to a known reason so nobody can
  // inject copy via ?reason=, and resolveNextPath refuses anything that is
  // not a plain internal path.
  const notice = sessionEndNotice(parseSessionEndReason(searchParams.get("reason")));

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

      // Straight to the destination — no interstitial (F-13).
      //
      // location.replace, not the Next router, for two reasons. The session
      // cookie was just set by the proxy on THIS response, and a full
      // document load guarantees middleware.ts sees it on the next request
      // rather than racing a client-side transition. It also replaces the
      // /login entry in history, so pressing Back from the dashboard does
      // not land on a login form the guardian has already passed.
      window.location.replace(resolveNextPath(searchParams.get("next")));
    } catch {
      setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
    }
  });

  const submitting = state.kind === "submitting";

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">schoolkit</h1>
        <p className="text-sm text-muted-foreground">Parent Portal</p>
      </div>

      {/* Shown only when the redirect actually carried a reason. A parent who
          pressed Sign out, or who is simply signing in, sees nothing —
          neither is a failure. role="status", not "alert": informative. */}
      {notice && (
        <div
          role="status"
          className="w-full max-w-sm rounded-lg border bg-card px-4 py-3 text-center"
        >
          <p className="text-sm font-medium">{notice.title}</p>
          <p className="text-sm text-muted-foreground">{notice.body}</p>
        </div>
      )}

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

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="••••••••"
              // pr-16 leaves room for the Show/Hide control so a long
              // password never runs underneath it.
              className="h-10 w-full rounded-md border border-input bg-background px-3 pr-16 text-sm"
              aria-invalid={Boolean(form.formState.errors.password)}
              aria-describedby={form.formState.errors.password ? "password-error" : undefined}
              {...form.register("password")}
            />
            {/* A real <button> rather than an icon-only div: it is reachable
                by Tab, activates on Enter/Space, and its accessible name says
                what pressing it will DO. aria-pressed communicates the
                current state to a screen reader without needing the label to
                double as a status. */}
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
          {form.formState.errors.password && (
            <p id="password-error" className="text-sm text-destructive">
              {form.formState.errors.password.message}
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
          {submitting ? "Signing in…" : "Log in"}
        </button>

        {/* F-06: there was no route out of a forgotten password at all — not
            a link, not a page, not an endpoint. A parent who forgot theirs
            had to phone the school and have an administrator re-issue an
            invitation. */}
        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-muted-foreground underline hover:text-foreground">
            Forgot password?
          </Link>
        </p>
      </form>
    </main>
  );
}

// useSearchParams requires a Suspense boundary in the App Router; without
// one, this route opts the whole page into client-side rendering at build
// time and Next warns about it.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
