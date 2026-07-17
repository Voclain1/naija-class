"use client";

// Phase 4 / Slice 2 — guardian portal accept-invitation page. New in this
// slice (no slice 1 stub existed for this route). Client component (not a
// server component) so it can both fetch the invitation on mount AND submit
// the accept form through the same same-origin proxy route — a server
// component fetching invitation details would still need a client island
// for the form, so this keeps everything in one file rather than splitting
// for no benefit at this size.

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import {
  acceptGuardianInvitationSchema,
  type AcceptGuardianInvitationInput,
  type PublicGuardianInvitationDto,
} from "@school-kit/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; invitation: PublicGuardianInvitationDto }
  | { kind: "error"; message: string };

type SubmitState = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

function errorMessageFrom(body: unknown, fallback: string): string {
  return body !== null && typeof body === "object" && "error" in body
    ? ((body as { error?: { message?: string } }).error?.message ?? fallback)
    : fallback;
}

export default function AcceptGuardianInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  const form = useForm<AcceptGuardianInvitationInput>({
    resolver: zodResolver(acceptGuardianInvitationSchema),
    defaultValues: { password: "", ndprConsent: false as unknown as true },
    mode: "onSubmit",
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/portal/invitations/${token}`)
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) {
          setLoadState({
            kind: "error",
            message: errorMessageFrom(body, "This invitation link is not valid."),
          });
          return;
        }
        setLoadState({ kind: "loaded", invitation: body as PublicGuardianInvitationDto });
      })
      .catch(() => {
        if (!cancelled) {
          setLoadState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitState({ kind: "submitting" });
    try {
      const res = await fetch(`/api/portal/invitations/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        setSubmitState({
          kind: "error",
          message: errorMessageFrom(body, "Something went wrong. Try again."),
        });
        return;
      }

      setSubmitState({ kind: "success" });
    } catch {
      setSubmitState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
    }
  });

  if (loadState.kind === "loading") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (loadState.kind === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Invitation not available</h1>
        <p className="text-sm text-muted-foreground">{loadState.message}</p>
        <Link href="/login" className="text-sm underline">
          Go to login
        </Link>
      </main>
    );
  }

  if (submitState.kind === "success") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-xl font-semibold tracking-tight">You&apos;re all set</h1>
        <p className="text-sm text-muted-foreground">
          Your portal account is ready.{" "}
          <Link href="/" className="underline">
            Continue
          </Link>
        </p>
      </main>
    );
  }

  const { invitation } = loadState;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Join {invitation.schoolName} on School Kit
        </h1>
        <p className="text-sm text-muted-foreground">
          Hi {invitation.firstName}, {invitation.invitedByName} invited you to the parent portal.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border bg-card p-6 shadow-sm"
        noValidate
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Choose a password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            aria-invalid={Boolean(form.formState.errors.password)}
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        <div className="flex items-start gap-2">
          <input
            id="ndprConsent"
            type="checkbox"
            className="mt-1"
            {...form.register("ndprConsent")}
          />
          <label htmlFor="ndprConsent" className="text-sm text-muted-foreground">
            I consent to School Kit processing my data to provide the parent portal, in line with
            NDPR.
          </label>
        </div>
        {form.formState.errors.ndprConsent && (
          <p className="text-sm text-destructive">{form.formState.errors.ndprConsent.message}</p>
        )}

        {submitState.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {submitState.message}
          </p>
        )}

        <button
          type="submit"
          disabled={submitState.kind === "submitting"}
          className="h-10 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitState.kind === "submitting" ? "Setting up…" : "Set password and continue"}
        </button>
      </form>
    </main>
  );
}
