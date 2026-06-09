"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SubjectRegisterEditor } from "@/components/teacher/attendance/subject-register-editor";
import { useSubjectAttendanceScope } from "@/components/teacher/attendance/use-subject-attendance-scope";

function todayLocalIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatMarkedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

// /teacher/attendance/subject — the subject-period register (opt-in). Subject
// picker first → arm (scoped to where the teacher teaches that subject) → date →
// period → roster grid. Gated on the school flag: if subject-period attendance
// is off, the page bounces to /teacher (the feature isn't available). Owner/admin
// reach it the same way (RequireAuth only) and see every subject/arm.
export default function SubjectAttendancePage() {
  const router = useRouter();
  const { state } = useSubjectAttendanceScope();
  const today = useMemo(() => todayLocalIso(), []);

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [armId, setArmId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(today);
  const [period, setPeriod] = useState<number>(1);
  const [lastMarkedAt, setLastMarkedAt] = useState<Date | null>(null);

  // Flag gate: bounce to /teacher when the school hasn't enabled the feature.
  useEffect(() => {
    if (state.kind === "ready" && !state.scope.subjectAttendanceEnabled) {
      router.replace("/teacher/dashboard");
    }
  }, [state, router]);

  const scope = state.kind === "ready" ? state.scope : null;
  const subjects = scope?.subjects ?? [];
  const arms = scope && subjectId ? scope.armsForSubject(subjectId) : [];

  // Auto-pick a single subject; then auto-pick a single arm for that subject.
  useEffect(() => {
    if (scope && subjectId === null && scope.subjects.length === 1) setSubjectId(scope.subjects[0]?.id ?? null);
  }, [scope, subjectId]);
  useEffect(() => {
    if (scope && subjectId && armId === null) {
      const armsForSubject = scope.armsForSubject(subjectId);
      if (armsForSubject.length === 1) setArmId(armsForSubject[0]?.id ?? null);
    }
  }, [scope, subjectId, armId]);

  // Reset the lifted stamp whenever the loaded register changes identity.
  useEffect(() => {
    setLastMarkedAt(null);
  }, [subjectId, armId, date, period]);

  // STABLE reference — the editor's load() depends on onLoaded, so an inline
  // arrow here would recreate load every render and spin the fetch effect into
  // an infinite loop (it sets a fresh Date into state each time). Mirrors the
  // slice-7 daily page's handleLoaded.
  const handleLoaded = useCallback((meta: { lastMarkedAt: Date | null }) => {
    setLastMarkedAt(meta.lastMarkedAt);
  }, []);

  function onSubjectChange(next: string | null): void {
    setSubjectId(next);
    setArmId(null); // arms depend on the subject
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href="/teacher/attendance"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Daily attendance
      </Link>

      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Subject attendance</h1>
          <Link href="/teacher/attendance/subject/summary" className="text-sm text-muted-foreground hover:text-foreground">
            Term summary →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Mark per-period attendance for a subject. Present, Absent, Late, or Excused.
        </p>
        {lastMarkedAt && (
          <p className="text-xs text-muted-foreground">Last marked at {formatMarkedTime(lastMarkedAt)}</p>
        )}
      </header>

      {state.kind === "loading" || (state.kind === "ready" && !state.scope.subjectAttendanceEnabled) ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : state.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {state.message}
        </div>
      ) : subjects.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">You&apos;re not assigned to teach any subjects.</p>
          <p className="mt-1">Subject attendance is marked by the teacher assigned to a subject.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Subject</span>
              <select
                value={subjectId ?? ""}
                onChange={(e) => onSubjectChange(e.target.value || null)}
                className="w-full min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  Select a subject…
                </option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Class</span>
              <select
                value={armId ?? ""}
                onChange={(e) => setArmId(e.target.value || null)}
                disabled={!subjectId}
                className="w-full min-w-44 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                <option value="" disabled>
                  {subjectId ? "Select a class…" : "Pick a subject first"}
                </option>
                {arms.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Date</span>
              <input
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Period</span>
              <input
                type="number"
                min={1}
                step={1}
                value={period}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  setPeriod(Number.isFinite(n) && n >= 1 ? n : 1);
                }}
                className="w-24 rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>

          {subjectId && armId ? (
            <SubjectRegisterEditor
              key={`${subjectId}:${armId}:${date}:${period}`}
              classArmId={armId}
              subjectId={subjectId}
              date={date}
              period={period}
              onLoaded={handleLoaded}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              Pick a subject and class to load the register.
            </div>
          )}
        </>
      )}
    </div>
  );
}
