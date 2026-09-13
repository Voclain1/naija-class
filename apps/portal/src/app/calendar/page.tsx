"use client";

// Phase 8 / CP1 — the school calendar for parents (docs/modules/phase-8.md §15).
// GET /api/portal/calendar → the API's single merged calendar read (D27): public
// holidays (minus any the school hid), term dates and the school's own events.
// Read-only by definition; a guardian has no calendar controls.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  CALENDAR_CATEGORY_LABELS,
  defaultCalendarWindow,
  formatCalendarMonth,
  formatCalendarRange,
  groupCalendarEntriesByMonth,
  type CalendarEntryDto,
  type CalendarResponse,
} from "@school-kit/types";

import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; entries: CalendarEntryDto[] };

export default function CalendarPage() {
  const router = useRouter();
  const calendarWindow = useMemo(() => defaultCalendarWindow(), []);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/portal/calendar?from=${encodeURIComponent(calendarWindow.from)}&to=${encodeURIComponent(calendarWindow.to)}`,
        );
        const body: unknown = await res.json().catch(() => null);
        if (res.status === 401) {
          router.replace(
            buildLoginUrl({
              reason: reasonFromErrorCode(errorCodeFromBody(body)),
              next: `${window.location.pathname}${window.location.search}`,
            }),
          );
          return;
        }
        if (!res.ok) {
          const message =
            body !== null && typeof body === "object" && "error" in body
              ? ((body as { error?: { message?: string } }).error?.message ?? "Something went wrong. Try again.")
              : "Could not reach the server. Try again in a moment.";
          if (!cancelled) setState({ kind: "error", message });
          return;
        }
        if (!cancelled) setState({ kind: "loaded", entries: (body as CalendarResponse).entries });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router, calendarWindow]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← Your children
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">School calendar</h1>
          <p className="text-sm text-muted-foreground">
            {formatCalendarRange(calendarWindow.from, calendarWindow.to)} · public holidays, term dates and school
            events.
          </p>
        </div>
        <SignOutButton />
      </header>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && state.entries.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          Nothing on the calendar for this period.
        </div>
      )}

      {state.kind === "loaded" &&
        groupCalendarEntriesByMonth(state.entries).map((group) => (
          <section key={group.month} aria-label={formatCalendarMonth(`${group.month}-01`)} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{formatCalendarMonth(`${group.month}-01`)}</h2>
            <ul className="flex flex-col divide-y rounded-lg border bg-card shadow-sm">
              {group.entries.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 p-4">
                  <span className="text-sm text-muted-foreground">{formatCalendarRange(e.startDate, e.endDate)}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{e.title}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {CALENDAR_CATEGORY_LABELS[e.category]}
                    </span>
                    {!e.dateConfirmed && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Expected — date not yet announced
                      </span>
                    )}
                  </div>
                  {e.description && (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{e.description}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
    </main>
  );
}
