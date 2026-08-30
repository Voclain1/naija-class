"use client";

// Phase 6 / Slice 3 — where a CHILD sets their own password.
//
// The audience here is a student, possibly quite young, on a phone, following
// a link a parent handed them. Copy is short and plain; there is no jargon,
// no "credentials", and no mention of tokens.
//
// This page deliberately does NOT sign the child in. Accepting returns a
// student session token, and the proxy discards it — see
// /api/student-portal/[...path]/route.ts for why. The child finishes here and
// signs in on the School Kit app, so a child's session never lands in
// whatever browser (very possibly a parent's) the link was opened in.
//
// It also never shows the child's NAME, because the API never returns one:
// this URL is guessable-in-principle and a name would turn a leaked link into
// a disclosure of which child it belongs to.

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PublicStudentInvitationDto } from "@school-kit/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; invitation: PublicStudentInvitationDto }
  | { kind: "done" };

const MIN_LENGTH = 8;

export default function StudentInvitePage() {
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/student-portal/invitations/${params.token}`);
      const body = await res.json();
      if (!res.ok) {
        // The API distinguishes 404 (never valid) from 410 (expired or
        // already used) so the child is told which, and what to do about it.
        setState({
          kind: "invalid",
          message:
            res.status === 410
              ? (body?.error?.message ?? "This link has already been used.")
              : "This link isn't valid. Ask your parent to send a new one.",
        });
        return;
      }
      setState({ kind: "ready", invitation: body as PublicStudentInvitationDto });
    } catch {
      setState({ kind: "invalid", message: "We couldn't reach SchoolKit. Try again shortly." });
    }
  }, [params.token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Checked here as well as on the server: a child mistyping their password
    // twice should be told immediately, not after a round trip.
    if (password.length < MIN_LENGTH) {
      setError(`Your password needs at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/student-portal/invitations/${params.token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      // The response contains a session token. It is intentionally ignored.
      setState({ kind: "done" });
    } catch {
      setError("We couldn't reach SchoolKit. Try again shortly.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {state.kind === "invalid" && (
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Link not working</h1>
          <p className="text-sm text-muted-foreground">{state.message}</p>
        </div>
      )}

      {state.kind === "done" && (
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re all set</h1>
          <p className="text-sm text-muted-foreground">
            Open the SchoolKit app and sign in with your admission number and
            the password you just chose.
          </p>
        </div>
      )}

      {state.kind === "ready" && (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Choose your password</h1>
            <p className="text-sm text-muted-foreground">
              This sets up your SchoolKit account at {state.invitation.schoolName}.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              className="rounded-md border px-3 py-2 text-base font-normal"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            Type it again
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={submitting}
              className="rounded-md border px-3 py-2 text-base font-normal"
            />
          </label>

          <p className="text-xs text-muted-foreground">
            At least {MIN_LENGTH} characters. Pick something you&apos;ll
            remember and don&apos;t share it.
          </p>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save password"}
          </button>
        </form>
      )}
    </main>
  );
}
