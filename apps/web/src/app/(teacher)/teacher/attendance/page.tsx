"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { RegisterEditor } from "@/components/teacher/attendance/register-editor";
import { useAttendanceScope } from "@/components/teacher/attendance/use-attendance-scope";

// Today's date as a YYYY-MM-DD string in the viewer's LOCAL timezone (not UTC) —
// the register is a calendar day in the school's locale. Doubles as the date
// input's `max` so the UI can't pick the future (the server defends too).
function todayLocalIso(): string {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

// "Last marked at 18:23" — local time-of-day (24h), matching the report-cards
// HH:MM convention. The selected date is already shown in the date picker, so
// the stamp only carries the time.
function formatMarkedTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}

// /teacher/attendance — the daily register. Owner/admin pick any arm; a form
// teacher is scoped to the arm(s) they form-teach. Pick an arm + a date (default
// today) → the RegisterEditor loads the roster and handles marking + saving.
export default function AttendanceRegisterPage() {
  const { state } = useAttendanceScope();
  const today = useMemo(() => todayLocalIso(), []);

  const [armId, setArmId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(today);
  // Latest markedAt for the loaded (arm × date), reported up by RegisterEditor.
  // Null when the date has no marks (→ stamp hidden, per the plan).
  const [lastMarkedAt, setLastMarkedAt] = useState<Date | null>(null);

  // Default the arm when the scope resolves: auto-pick when there's exactly one
  // (the common form-teacher case); otherwise leave on the placeholder.
  const arms = state.kind === "ready" ? state.scope.arms : [];
  useEffect(() => {
    if (state.kind === "ready" && armId === null && state.scope.arms.length === 1) {
      setArmId(state.scope.arms[0]?.id ?? null);
    }
  }, [state, armId]);

  // Clear the stamp the instant the arm/date changes so a stale time never
  // lingers over the new register while it loads; the editor re-reports onLoaded.
  useEffect(() => {
    setLastMarkedAt(null);
  }, [armId, date]);

  const handleLoaded = useCallback((meta: { lastMarkedAt: Date | null }) => {
    setLastMarkedAt(meta.lastMarkedAt);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Attendance</h1>
          <Link
            href="/teacher/attendance/summary"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Term summary →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Mark the daily register for your class. Present, Absent, Late, or Excused.
        </p>
      </header>

      {state.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : state.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {state.message}
        </div>
      ) : arms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          {state.scope.isManager ? (
            <>
              <p className="font-medium text-foreground">No classes set up yet.</p>
              <p className="mt-1">Create class arms under Academics before marking attendance.</p>
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">
                You&apos;re not assigned as form teacher of any arm.
              </p>
              <p className="mt-1">Daily attendance is taken by the form teacher of a class.</p>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Class</span>
              <select
                value={armId ?? ""}
                onChange={(e) => setArmId(e.target.value || null)}
                className="w-full min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="" disabled>
                  Select a class…
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
          </div>

          {armId && lastMarkedAt && (
            <p className="text-sm text-muted-foreground">
              Last marked at{" "}
              <span className="font-medium text-foreground">{formatMarkedTime(lastMarkedAt)}</span>
            </p>
          )}

          {armId ? (
            <RegisterEditor
              key={`${armId}:${date}`}
              classArmId={armId}
              date={date}
              onLoaded={handleLoaded}
            />
          ) : (
            <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
              Pick a class to load its register.
            </div>
          )}
        </>
      )}
    </div>
  );
}
