"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { formatSickbayDay, type AdmissionTrackDto } from "@school-kit/types";

import { PageHeader, PageSkeleton } from "@school-kit/ui";

// Phase 9 / CP7.1 — the family's private tracking link (docs/modules/
// phase-9.md §16.8 answer 3), sent in every email. No login: the link is the
// key, and it shows this one application only. The assessment, the offer
// letter, accepting and withdrawing come in CP7.2.

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
          <p className="text-xs text-muted-foreground">Keep this link private. The school also writes to you by email at each step.</p>
        </section>
      )}
    </main>
  );
}
