"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { formatSickbayDay, type AdmissionTrackDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

// Phase 9 / CP7.1 — the family's private tracking link (docs/modules/
// phase-9.md §16.8 answer 3), sent in every email. No login: the link is the
// key, and it shows this one application only. CP7.2: the assessment, the
// offer letter IN FULL with Accept the offer beneath it (§16.8 answer 2), and
// Withdraw while the application is open.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; app: AdmissionTrackDto };

export default function TrackApplicationPage() {
  const params = useParams<{ slug: string; token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/apply/${encodeURIComponent(params.slug)}/track/${encodeURIComponent(params.token)}`);
        if (res.status === 404) return void (!cancelled && setState({ kind: "missing" }));
        if (!res.ok) return void (!cancelled && setState({ kind: "error" }));
        const app = (await res.json()) as AdmissionTrackDto;
        if (!cancelled) setState({ kind: "ready", app });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.slug, params.token]);

  const app = state.kind === "ready" ? state.app : null;
  const [saw, setSaw] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(step: "accept" | "withdraw") {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_BASE}/apply/${encodeURIComponent(params.slug)}/track/${encodeURIComponent(params.token)}/${step}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(step === "accept" ? { familySawLetter: true } : {}),
      });
      const body = (await res.json().catch(() => null)) as (AdmissionTrackDto & { error?: { message?: string } }) | null;
      if (!res.ok || !body) {
        setActionError(body?.error?.message ?? "That did not go through. Try again, or contact the school.");
        return;
      }
      setState({ kind: "ready", app: body });
      setConfirmWithdraw(false);
    } catch {
      setActionError("That did not go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <PageHeader title={app ? `${app.schoolName}: your application` : "Your application"} />
      {state.kind === "loading" && <PageSkeleton rows={2} />}
      {state.kind === "missing" && (
        <p className="text-sm text-muted-foreground">This link does not open an application. It may have been deleted, or the link was copied wrongly.</p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          We couldn&apos;t load the application. Try again shortly.
        </p>
      )}
      {app && (
        <section className="flex flex-col gap-3 rounded-lg border bg-card p-5">
          <p className="text-lg font-semibold">{app.statusLabel}</p>
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Child</dt>
              <dd>{app.childFirstName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Class</dt>
              <dd>{app.classLevel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reference</dt>
              <dd>{app.reference}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sent</dt>
              <dd>{formatSickbayDay(app.submittedAt)}</dd>
            </div>
          </dl>
          {app.decision.assessment && (
            <div className="rounded-md bg-muted/60 p-3 text-sm">
              <p className="font-medium">{app.decision.assessment.label}</p>
              <p>
                {app.decision.assessment.day} at {app.decision.assessment.time}
              </p>
              {app.decision.assessment.note && <p className="whitespace-pre-wrap break-words">{app.decision.assessment.note}</p>}
            </div>
          )}
          {app.decision.decisionNote && <p className="whitespace-pre-wrap break-words text-sm">{app.decision.decisionNote}</p>}
          {app.decision.offerLetter && (
            <div className="space-y-2">
              <h2 className="text-base font-semibold">The offer letter</h2>
              <div className="whitespace-pre-wrap break-words rounded-md bg-muted/60 p-3 text-sm">{app.decision.offerLetter}</div>
            </div>
          )}
          {app.decision.canAccept && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={saw} onChange={(e) => setSaw(e.target.checked)} />
                <span>I have read the full offer letter above.</span>
              </label>
              <button
                type="button"
                className="h-10 w-full rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50 sm:w-auto"
                disabled={!saw || busy}
                onClick={() => void act("accept")}
              >
                Accept the offer
              </button>
            </div>
          )}
          {app.decision.acceptedAt && app.status === "OFFER_ACCEPTED" && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              Accepted on {formatSickbayDay(app.decision.acceptedAt)}. The school will complete the admission.
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
          {app.decision.canWithdraw &&
            (confirmWithdraw ? (
              <div className="space-y-2 rounded-md bg-muted/60 p-3 text-sm">
                <p>Withdraw this application? The school is told, and you cannot undo it here.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="h-9 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground" disabled={busy} onClick={() => void act("withdraw")}>
                    Withdraw the application
                  </button>
                  <button type="button" className="h-9 rounded-md border px-3 text-sm" onClick={() => setConfirmWithdraw(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="self-start text-sm text-muted-foreground underline" onClick={() => setConfirmWithdraw(true)}>
                Withdraw the application
              </button>
            ))}
          <p className="text-xs text-muted-foreground">Keep this link private. The school also writes to you by email at each step.</p>
        </section>
      )}
    </main>
  );
}
