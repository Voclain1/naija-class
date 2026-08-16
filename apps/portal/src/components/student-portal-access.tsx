"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  DeactivateStudentPortalResponse,
  IssueStudentInvitationResponse,
  StudentPortalStatusDto,
} from "@school-kit/types";

// Phase 6 / Slice 3 — the guardian's control over their child's own School
// Kit account, on the child's detail page.
//
// This is the first surface in the product where a parent grants and revokes
// a CHILD's access, so the copy carries more weight than usual:
//
//   - "Turn off access" is destructive and irreversible-without-a-new-link.
//     It is confirmed, and the confirmation says what actually happens
//     ("you'll need to send a new invite") rather than a generic
//     "Are you sure?".
//   - The invite link is shown exactly once, because that is literally true:
//     the server keeps only a hash. The UI says so, rather than letting a
//     parent assume they can come back for it.
//   - Nothing here claims a state it has not re-read from the server. Every
//     action refetches status rather than patching local state, because a
//     parent looking at "off" needs it to be actually off.

interface Props {
  studentId: string;
  firstName: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; status: StudentPortalStatusDto };

function describeState(status: StudentPortalStatusDto, firstName: string): string {
  switch (status.state) {
    case "ACTIVE":
      return `${firstName} can sign in to School Kit.`;
    case "DEACTIVATED":
      return `${firstName}'s access is turned off. Send a new invite to switch it back on.`;
    case "NEVER_ACTIVATED":
      return status.hasPendingInvitation
        ? `You've sent an invite. ${firstName} hasn't used it yet.`
        : `${firstName} doesn't have an account yet.`;
  }
}

export function StudentPortalAccess({ studentId, firstName }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [busy, setBusy] = useState<null | "invite" | "deactivate">(null);
  const [issued, setIssued] = useState<IssueStudentInvitationResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/students/${studentId}/portal-status`);
      if (!res.ok) {
        setStatus({ kind: "error", message: "Could not load account status." });
        return;
      }
      setStatus({ kind: "loaded", status: (await res.json()) as StudentPortalStatusDto });
    } catch {
      setStatus({ kind: "error", message: "Could not reach the server." });
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function issueInvite() {
    setBusy("invite");
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/students/${studentId}/portal-invitation`, {
        method: "POST",
      });
      if (!res.ok) {
        setActionError("Could not create an invite link. Please try again.");
        return;
      }
      setIssued((await res.json()) as IssueStudentInvitationResponse);
      await load();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function deactivate() {
    setBusy("deactivate");
    setActionError(null);
    try {
      const res = await fetch(`/api/portal/students/${studentId}/deactivate`, {
        method: "POST",
      });
      if (!res.ok) {
        setActionError("Could not turn off access. Please try again.");
        return;
      }
      const body = (await res.json()) as DeactivateStudentPortalResponse;
      // The old link stops working the moment access is turned off, so
      // leaving it on screen would be actively misleading.
      setIssued(null);
      setConfirming(false);
      await load();
      if (body.sessionsRevoked > 0) {
        setActionError(null);
      }
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  if (status.kind === "loading") return null;

  if (status.kind === "error") {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">School Kit account</h2>
        <p className="text-sm text-destructive">{status.message}</p>
      </section>
    );
  }

  const s = status.status;
  const isActive = s.state === "ACTIVE";

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">School Kit account</h2>

      <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
        <p className="text-sm">{describeState(s, firstName)}</p>

        {s.state === "ACTIVE" && s.lastLoginAt && (
          <p className="text-xs text-muted-foreground">
            Last signed in {new Date(s.lastLoginAt).toLocaleDateString()}
          </p>
        )}

        {issued && (
          <div className="rounded-md border border-dashed bg-muted/40 p-3 flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Invite link — shown once
            </p>
            <code className="break-all text-xs">
              {typeof window !== "undefined" ? window.location.origin : ""}
              /student-invite/{issued.token}
            </code>
            <p className="text-xs text-muted-foreground">
              Give this to {firstName}. We can&apos;t show it again — if it&apos;s lost,
              send a new one.
              {issued.revokedPrevious > 0 && " Any earlier link has stopped working."}
            </p>
          </div>
        )}

        {actionError && (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void issueInvite()}
            disabled={busy !== null}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy === "invite"
              ? "Creating…"
              : s.state === "DEACTIVATED"
                ? "Send a new invite"
                : s.hasPendingInvitation
                  ? "Send a new invite"
                  : "Invite to School Kit"}
          </button>

          {/* Only offered when there is something to turn off. Showing a
              disabled "turn off" against an account that was never on reads
              as though access exists. */}
          {(isActive || s.hasPendingInvitation) && !confirming && (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={busy !== null}
              className="rounded-md border border-destructive px-3 py-2 text-sm font-medium text-destructive disabled:opacity-50"
            >
              Turn off access
            </button>
          )}
        </div>

        {confirming && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 flex flex-col gap-2">
            <p className="text-sm">
              Turn off {firstName}&apos;s access? They&apos;ll be signed out
              straight away, any invite link you sent will stop working, and
              you&apos;ll need to send a new invite to switch it back on.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void deactivate()}
                disabled={busy !== null}
                className="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50"
              >
                {busy === "deactivate" ? "Turning off…" : "Yes, turn it off"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy !== null}
                className="rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50"
              >
                Keep it on
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
