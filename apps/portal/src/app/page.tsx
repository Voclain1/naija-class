"use client";

// Phase 4 / Slice 4 — replaces slice 2's "You're signed in" placeholder.
// That version only checked the sk_portal_session cookie's PRESENCE
// server-side (see its own removed comment) because no protected endpoint
// existed yet to actually validate it. This version fetches
// GET /api/portal/students on mount — a 401 means the session is missing/
// invalid/expired, so it redirects to /login there, which is the real
// validity check the slice 2 code deferred to "slice 4's parent view."

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { PortalStudentDto } from "@school-kit/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; students: PortalStudentDto[] };

export default function DashboardPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/portal/students");
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            body !== null && typeof body === "object" && "error" in body
              ? ((body as { error?: { message?: string } }).error?.message ??
                  "Something went wrong. Try again.")
              : "Could not reach the server. Try again in a moment.";
          if (!cancelled) setState({ kind: "error", message });
          return;
        }
        const students = (body as { data: PortalStudentDto[] }).data;
        if (!cancelled) setState({ kind: "loaded", students });
      } catch {
        if (!cancelled) {
          setState({
            kind: "error",
            message: "Could not reach the server. Try again in a moment.",
          });
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Your children</h1>
        <p className="text-sm text-muted-foreground">
          Select a child to see their fees and invoices.
        </p>
      </header>

      {state.kind === "loading" && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && state.students.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
          No children are linked to your account yet. Contact the school if
          this doesn&apos;t look right.
        </div>
      )}

      {state.kind === "loaded" && state.students.length > 0 && (
        <ul className="flex flex-col gap-3">
          {state.students.map((student) => (
            <li key={student.id}>
              <Link
                href={`/students/${student.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    {student.firstName} {student.lastName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {student.currentEnrollment
                      ? `${student.currentEnrollment.classArm.classLevel.name} ${student.currentEnrollment.classArm.name}`
                      : "Not enrolled this term"}
                  </span>
                </div>
                <span aria-hidden className="text-muted-foreground">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
