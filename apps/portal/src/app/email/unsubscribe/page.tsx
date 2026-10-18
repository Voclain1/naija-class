"use client";

// Phase 9 / CP8.3 — "Stop announcement emails" (docs/modules/phase-9.md
// §17.11). Opened from the link in an announcement email; no sign-in, the
// link is the proof. Opening the page does not unsubscribe (mail scanners
// open links): the parent presses the button. Messages from the school and
// receipts still arrive.

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import type { EmailUnsubscribeStatusDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

function Unsubscribe() {
  const params = useSearchParams();
  const link = { s: params.get("s") ?? "", e: params.get("e") ?? "", t: params.get("t") ?? "" };
  const [status, setStatus] = useState<EmailUnsubscribeStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qs = new URLSearchParams(link).toString();

  useEffect(() => {
    void fetch(`/api/email/unsubscribe?${qs}`)
      .then(async (r) => {
        const body: unknown = await r.json().catch(() => null);
        if (r.ok) setStatus(body as EmailUnsubscribeStatusDto);
        else setError("This link is not valid. Use the link in the latest email from the school.");
      })
      .catch(() => setError("Could not reach the server. Try again in a moment."));
  }, [qs]);

  async function set(subscribe: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/email/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...link, subscribe }) });
      const body: unknown = await r.json().catch(() => null);
      if (r.ok) setStatus(body as EmailUnsubscribeStatusDto);
      else setError("That did not work. Try again in a moment.");
    } catch {
      setError("Could not reach the server. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !status) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }
  if (!status) return <PageSkeleton rows={2} />;
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-5 text-sm">
      {status.subscribed ? (
        <>
          <p className="break-words">
            You get announcement emails from {status.schoolName} at <span className="font-medium">{link.e}</span>.
          </p>
          <button type="button" disabled={busy} onClick={() => void set(false)} className="h-10 self-start rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-50">
            Stop announcement emails
          </button>
        </>
      ) : (
        <>
          <p className="break-words">
            You will no longer get announcement emails from {status.schoolName} at <span className="font-medium">{link.e}</span>.
            Messages from the school and receipts still arrive, and announcements are still in the parent portal and the app.
          </p>
          <button type="button" disabled={busy} onClick={() => void set(true)} className="h-10 self-start rounded-md border px-4 font-medium disabled:opacity-50">
            Undo: email me announcements again
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export default function UnsubscribePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-10">
      <PageHeader title="Announcement emails" />
      <Suspense fallback={<PageSkeleton rows={2} />}>
        <Unsubscribe />
      </Suspense>
    </main>
  );
}
