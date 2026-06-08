"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { AttendanceSummaryResponse } from "@school-kit/types";

import { useAttendanceScope } from "@/components/teacher/attendance/use-attendance-scope";
import { ApiError } from "@/lib/api-client";
import { getSummary } from "@/lib/attendance/attendance-api";
import { formatAverage } from "@/lib/report-cards/format";

type SummaryState =
  | { kind: "idle" } // no arm/term picked yet
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: AttendanceSummaryResponse };

// /teacher/attendance/summary — per-student attendance stats for one (arm ×
// term), plus the arm-level rollup. Same arm/term scoping as the register
// (owner/admin pick any; a form teacher sees their arm + the current term).
// Rates come from the API as Int hundredths → formatAverage renders "85.00%".
export default function AttendanceSummaryPage() {
  const { state: scopeState } = useAttendanceScope();

  const [armId, setArmId] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ kind: "idle" });

  const arms = scopeState.kind === "ready" ? scopeState.scope.arms : [];
  const terms = scopeState.kind === "ready" ? scopeState.scope.terms : [];

  // Default arm (single) + term (current) once the scope resolves.
  useEffect(() => {
    if (scopeState.kind !== "ready") return;
    if (armId === null && scopeState.scope.arms.length === 1) setArmId(scopeState.scope.arms[0]?.id ?? null);
    if (termId === null && scopeState.scope.currentTermId) setTermId(scopeState.scope.currentTermId);
  }, [scopeState, armId, termId]);

  const load = useCallback(async () => {
    if (!armId || !termId) {
      setSummary({ kind: "idle" });
      return;
    }
    setSummary({ kind: "loading" });
    try {
      setSummary({ kind: "ready", data: await getSummary(armId, termId) });
    } catch (e) {
      setSummary({
        kind: "error",
        message: e instanceof ApiError ? e.message : "Could not load the summary.",
      });
    }
  }, [armId, termId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link
        href="/teacher/attendance"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Daily register
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Attendance summary</h1>
        <p className="text-sm text-muted-foreground">
          Per-student attendance for the term, with the class rate.
        </p>
      </header>

      {scopeState.kind === "loading" ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : scopeState.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {scopeState.message}
        </div>
      ) : arms.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          {scopeState.scope.isManager ? (
            <p className="font-medium text-foreground">No classes set up yet.</p>
          ) : (
            <p className="font-medium text-foreground">
              You&apos;re not assigned as form teacher of any arm.
            </p>
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
              <span className="font-medium">Term</span>
              {scopeState.scope.isManager ? (
                <select
                  value={termId ?? ""}
                  onChange={(e) => setTermId(e.target.value || null)}
                  className="w-full min-w-48 rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="" disabled>
                    Select a term…
                  </option>
                  {terms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.isCurrent ? " (current)" : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  {terms[0]?.name ?? "No current term"}
                </span>
              )}
            </label>
          </div>

          <SummaryBody state={summary} />
        </>
      )}
    </div>
  );
}

function SummaryBody({ state }: { state: SummaryState }) {
  if (state.kind === "idle") {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
        Pick a class and term to see the summary.
      </div>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50" />
        ))}
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {state.message}
      </div>
    );
  }
  if (state.data.summary.length === 0) {
    return (
      <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No attendance yet.</p>
        <p className="mt-1">No attendance has been marked for this arm this term.</p>
      </div>
    );
  }

  const { summary, armSummary } = state.data;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Student</th>
            <th className="px-3 py-2 text-right font-medium">Days marked</th>
            <th className="px-3 py-2 text-right font-medium">Present</th>
            <th className="px-3 py-2 text-right font-medium">Absent</th>
            <th className="px-3 py-2 text-right font-medium">Late</th>
            <th className="px-3 py-2 text-right font-medium">Excused</th>
            <th className="px-3 py-2 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((r) => (
            <tr key={r.studentId} className="border-t">
              <td className="px-3 py-2">
                <div className="font-medium">{r.fullName}</div>
                <div className="text-xs text-muted-foreground">{r.admissionNumber}</div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{r.daysMarked}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.presentCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.absentCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.lateCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.excusedCount}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {formatAverage(r.attendanceRate)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/30 text-sm">
          <tr>
            <td className="px-3 py-2 font-medium" colSpan={6}>
              {armSummary.totalDaysOperated} day{armSummary.totalDaysOperated === 1 ? "" : "s"} operated
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              {formatAverage(armSummary.armAttendanceRate)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
