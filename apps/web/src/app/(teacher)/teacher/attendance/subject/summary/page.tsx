"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { SubjectAttendanceSummaryResponse } from "@school-kit/types";

import { useSubjectAttendanceScope } from "@/components/teacher/attendance/use-subject-attendance-scope";
import { ApiError } from "@/lib/api-client";
import { formatAverage } from "@/lib/report-cards/format";
import { getSubjectSummary } from "@/lib/subject-attendance/subject-attendance-api";

type SummaryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: SubjectAttendanceSummaryResponse };

// /teacher/attendance/subject/summary — per-student subject-period stats for one
// (subject, arm, term). Same subject→arm scoping + flag gate as the register.
export default function SubjectAttendanceSummaryPage() {
  const router = useRouter();
  const { state: scopeState } = useSubjectAttendanceScope();

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [armId, setArmId] = useState<string | null>(null);
  const [termId, setTermId] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryState>({ kind: "idle" });

  useEffect(() => {
    if (scopeState.kind === "ready" && !scopeState.scope.subjectAttendanceEnabled) {
      router.replace("/teacher/dashboard");
    }
  }, [scopeState, router]);

  const scope = scopeState.kind === "ready" ? scopeState.scope : null;
  const subjects = scope?.subjects ?? [];
  const arms = scope && subjectId ? scope.armsForSubject(subjectId) : [];
  const terms = scope?.terms ?? [];

  useEffect(() => {
    if (scope && subjectId === null && scope.subjects.length === 1) setSubjectId(scope.subjects[0]?.id ?? null);
    if (scope && termId === null && scope.currentTermId) setTermId(scope.currentTermId);
  }, [scope, subjectId, termId]);
  useEffect(() => {
    if (scope && subjectId && armId === null) {
      const armsForSubject = scope.armsForSubject(subjectId);
      if (armsForSubject.length === 1) setArmId(armsForSubject[0]?.id ?? null);
    }
  }, [scope, subjectId, armId]);

  const load = useCallback(async () => {
    if (!subjectId || !armId || !termId) {
      setSummary({ kind: "idle" });
      return;
    }
    setSummary({ kind: "loading" });
    try {
      setSummary({ kind: "ready", data: await getSubjectSummary(armId, subjectId, termId) });
    } catch (e) {
      setSummary({ kind: "error", message: e instanceof ApiError ? e.message : "Could not load the summary." });
    }
  }, [subjectId, armId, termId]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSubjectChange(next: string | null): void {
    setSubjectId(next);
    setArmId(null);
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link
        href="/teacher/attendance/subject"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Subject register
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Subject attendance summary</h1>
        <p className="text-sm text-muted-foreground">
          Per-student attendance for a subject over the term, with the class rate.
        </p>
      </header>

      {scopeState.kind === "loading" || (scopeState.kind === "ready" && !scopeState.scope.subjectAttendanceEnabled) ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : scopeState.kind === "error" ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {scopeState.message}
        </div>
      ) : subjects.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">You&apos;re not assigned to teach any subjects.</p>
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
              <span className="font-medium">Term</span>
              {scope?.isManager ? (
                <select
                  value={termId ?? ""}
                  onChange={(e) => setTermId(e.target.value || null)}
                  className="w-full min-w-44 rounded-md border bg-background px-3 py-2 text-sm"
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
        Pick a subject, class, and term to see the summary.
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
        <p className="mt-1">No subject attendance has been marked for this class this term.</p>
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
            <th className="px-3 py-2 text-right font-medium">Periods marked</th>
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
              <td className="px-3 py-2 text-right tabular-nums">{r.periodsMarked}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.presentCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.absentCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.lateCount}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.excusedCount}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{formatAverage(r.attendanceRate)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/30 text-sm">
          <tr>
            <td className="px-3 py-2 font-medium" colSpan={6}>
              {armSummary.totalDaysOperated} day{armSummary.totalDaysOperated === 1 ? "" : "s"} ·{" "}
              {armSummary.totalPeriodsOperated} period{armSummary.totalPeriodsOperated === 1 ? "" : "s"} operated
            </td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">
              {formatAverage(armSummary.subjectAttendanceRate)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
