"use client";

/* eslint-disable @next/next/no-img-element -- a signed, five-minute photo link */
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { IdCardVerdictDto, IdCardVerificationDto } from "@school-kit/types";

import { PageSkeleton } from "@school-kit/ui";

// The page an ID card's QR code opens (docs/modules/id-cards-and-store.md §3,
// owner's answer 3). Public: the code is the credential. It shows only what
// the card's front shows, and whether the card is valid, so a gate-man or a
// visitor can tell a real, current card from a fake, old or cancelled one.
//
// Calls the API directly from the browser, like the Result Checker, so the
// per-address limit applies to each phone rather than to the portal server.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

type State =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "error" }
  | { kind: "ready"; check: IdCardVerificationDto };

const VERDICT: Record<IdCardVerdictDto, { title: string; body: string; tint: string }> = {
  VALID: {
    title: "Valid card",
    body: "This card was issued by the school and is current.",
    tint: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  },
  EXPIRED: {
    title: "Expired card",
    body: "This card was issued by the school for a session that has ended.",
    tint: "bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  },
  CANCELLED: {
    title: "Cancelled card",
    body: "The school has cancelled this card. Do not accept it.",
    tint: "bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-100",
  },
  REPLACED: {
    title: "Replaced card",
    body: "This card was reported lost or damaged and a new one was issued. Do not accept this one.",
    tint: "bg-red-50 text-red-900 dark:bg-red-950/50 dark:text-red-100",
  },
};

export default function IdCardCheckPage() {
  const params = useParams<{ token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE}/id-card-check/${encodeURIComponent(params.token)}`);
        if (cancelled) return;
        if (response.status === 404) return setState({ kind: "unknown" });
        if (!response.ok) return setState({ kind: "error" });
        setState({ kind: "ready", check: (await response.json()) as IdCardVerificationDto });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 py-8">
      <h1 className="font-serif text-2xl font-medium tracking-tight">ID card check</h1>
      {state.kind === "loading" && <PageSkeleton rows={3} />}
      {state.kind === "unknown" && (
        <section className="rounded-md bg-red-50 p-4 text-red-900 dark:bg-red-950/50 dark:text-red-100">
          <p className="font-semibold">Not recognised</p>
          <p className="text-sm">This code is not a School Kit ID card. The card may be fake. Contact the school.</p>
        </section>
      )}
      {state.kind === "error" && (
        <p className="text-sm text-muted-foreground">We could not check the card just now. Try again in a moment.</p>
      )}
      {state.kind === "ready" && <Verdict check={state.check} />}
    </main>
  );
}

function Verdict({ check }: { check: IdCardVerificationDto }) {
  const v = VERDICT[check.verdict];
  return (
    <>
      <section className={`rounded-md p-4 ${v.tint}`} aria-live="polite">
        <p className="text-lg font-semibold">{v.title}</p>
        <p className="text-sm">{v.body}</p>
      </section>
      <section className="flex gap-4 rounded-md border bg-card p-4">
        {check.photoUrl ? (
          <img src={check.photoUrl} alt={`Photo of ${check.name}`} className="h-[120px] w-[93px] shrink-0 rounded-md border object-cover" />
        ) : (
          <div className="flex h-[120px] w-[93px] shrink-0 items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
            No photo
          </div>
        )}
        <dl className="flex min-w-0 flex-col gap-1 text-sm">
          <dt className="sr-only">Name</dt>
          <dd className="text-base font-semibold">{check.name}</dd>
          <dt className="sr-only">School</dt>
          <dd>{check.schoolName}</dd>
          <dt className="sr-only">Class or role</dt>
          <dd>
            {check.kind === "STUDENT" ? "Student" : "Staff"}
            {check.detail ? ` · ${check.detail}` : ""}
          </dd>
          <dd className="text-muted-foreground">Session {check.validFor}</dd>
          <dd className="text-muted-foreground">
            Card no. <span className="font-mono">{check.cardNumber}</span>
          </dd>
        </dl>
      </section>
      <p className="text-xs text-muted-foreground">Compare the photo with the person holding the card.</p>
    </>
  );
}
