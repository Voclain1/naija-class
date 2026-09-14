"use client";

// Phase 8 / CP4 — a child's class timetable for parents (docs/modules/phase-8.md
// §18 D39, D45). GET /api/portal/students/:id/timetable → THE family reader,
// which returns only what the school PUBLISHED for the child's class this term.
// A timetable the school is still editing is never shown here.

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ISO_WEEKDAY_LABELS,
  formatCalendarDate,
  formatMinuteOfDay,
  publishedDay,
  type FamilyTimetableDto,
} from "@school-kit/types";

import { SignOutButton } from "@/components/sign-out-button";
import { buildLoginUrl, errorCodeFromBody, reasonFromErrorCode } from "@/lib/session-end";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "loaded"; data: FamilyTimetableDto };

const EMPTY: Record<Exclude<FamilyTimetableDto["state"], "PUBLISHED">, (d: FamilyTimetableDto) => string> = {
  NO_CURRENT_TERM: () => "The school hasn't set the current term yet.",
  NOT_ENROLLED: (d) => `Your child isn't in a class for ${d.termName ?? "this term"}, so there is no class timetable to show.`,
  NOT_PUBLISHED: (d) => `The school hasn't published a timetable for ${d.className ?? "this class"} yet.`,
};

export default function ChildTimetablePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/portal/students/${encodeURIComponent(params.id)}/timetable`);
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
        if (!cancelled) setState({ kind: "loaded", data: body as FamilyTimetableDto });
      } catch {
        if (!cancelled) setState({ kind: "error", message: "Could not reach the server. Try again in a moment." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [router, params.id]);

  const data = state.kind === "loaded" ? state.data : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href={`/students/${params.id}`} className="text-sm text-muted-foreground hover:underline">
            ← Back to your child
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Class timetable</h1>
          {data?.state === "PUBLISHED" && (
            <p className="text-sm text-muted-foreground">
              {data.className} · {data.termName} · published by the school on {formatCalendarDate(data.publishedAt!.slice(0, 10))}
            </p>
          )}
        </div>
        <SignOutButton />
      </header>

      {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {data && data.state !== "PUBLISHED" && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">{EMPTY[data.state](data)}</div>
      )}

      {data?.state === "PUBLISHED" &&
        data.grid!.days.map((day) => (
          <section key={day} aria-label={ISO_WEEKDAY_LABELS[day]} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{ISO_WEEKDAY_LABELS[day]}</h2>
            <ol className="flex flex-col divide-y rounded-lg border bg-card shadow-sm">
              {publishedDay(data.grid!, day).map((row) => (
                <li key={`${day}-${row.slot.position}`} className={`flex gap-3 p-3 ${row.slot.kind !== "LESSON" ? "bg-muted/50" : ""}`}>
                  <span className="w-28 shrink-0 text-sm text-muted-foreground">
                    {formatMinuteOfDay(row.slot.startMinute)}–{formatMinuteOfDay(row.endMinute)}
                  </span>
                  {row.slot.kind !== "LESSON" ? (
                    <span className="text-sm text-muted-foreground">{row.slot.label}</span>
                  ) : row.lesson ? (
                    <span className="flex flex-col">
                      <span className="font-medium">{row.lesson.subjectName}</span>
                      {row.lesson.teacherNames.length > 0 && (
                        <span className="text-sm text-muted-foreground">{row.lesson.teacherNames.join(", ")}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">{row.slot.label} — free</span>
                  )}
                </li>
              ))}
            </ol>
          </section>
        ))}
    </main>
  );
}
