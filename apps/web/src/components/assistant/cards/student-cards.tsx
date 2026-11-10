"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { AttendanceSummaryRowDto, ReportCardBoardRowDto, StudentLookupResultDto, StudentRecordSection } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { assistantApi } from "@/lib/assistant/api";
import { getSummary } from "@/lib/attendance/attendance-api";
import { getReportCardBoard } from "@/lib/report-cards/report-card-api";

import { useAssistant } from "../assistant-provider";
import { CardShell, Field, Notice, control } from "./common";

// Named student lookup (docs/modules/assistant-workspace.md, "Named student
// lookup"). Everything here is the UI channel: names, admission numbers and
// records are shown to the person and NEVER sent to the model. The server
// decided who could be found (tenant, role, student.read, a teacher's own
// classes); each record section is read from its own existing endpoint, which
// checks its own permission again. Nothing here changes a record.

const STATUS_TEXT: Record<StudentLookupResultDto["status"], string> = {
  found: "One student matches.",
  several: "More than one student matches. Choose the right one.",
  similar: "No exact match. These are close spellings: choose one, or search again.",
  none: "No student you can see matches. Check the name or the class, and search again.",
};

/** The matches for a name: pick one to see their record. */
export function StudentMatchesCard({ asked, status, studentIds }: { asked: string; status: StudentLookupResultDto["status"]; studentIds: string[] }) {
  const { store, state } = useAssistant();
  const entries = studentIds.flatMap((id) => {
    const e = state.students.find((x) => x.studentId === id);
    return e ? [e] : [];
  });
  return (
    <CardShell title="Students" status={status === "found" ? "Found" : status === "none" ? "No match" : "Choose one"} tone={status === "none" ? "warning" : "default"}>
      <p className="text-xs text-muted-foreground">For “{asked}”. {STATUS_TEXT[status]}</p>
      {entries.length > 0 && (
        <ul className="space-y-1" data-ph-mask data-sentry-mask>
          {entries.map((e) => (
            <li key={e.studentId}>
              <button
                type="button"
                className="flex w-full flex-wrap items-baseline justify-between gap-x-2 rounded-lg bg-muted/40 px-3 py-2 text-left hover:bg-accent"
                aria-pressed={e.selected}
                onClick={() => store.selectStudent(e.studentId)}
              >
                <span className="font-medium">{e.match.name}</span>
                <span className="text-xs text-muted-foreground">
                  {e.match.admissionNumber} · {e.match.classLabel ?? "No class this term"}
                  {e.match.match === "similar" ? " · similar spelling" : ""}
                  {e.selected ? " · selected" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

/** The on-device search (no model): a name and, optionally, a class. */
export function StudentSearchCard({ query, classHints }: { query: string; classHints: string[] }) {
  const { store } = useAssistant();
  const [name, setName] = useState(query);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  async function search() {
    if (name.trim().length < 2) return;
    setBusy(true); setError(null);
    try {
      const result = await assistantApi.findStudents({ name: name.trim() });
      // A class named in the request narrows the matches on screen (by the class label the server returned).
      const narrowed = classHints.length
        ? { ...result, matches: result.matches.filter((m) => classHints.some((h) => (m.classLabel ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(h))) }
        : result;
      const fixed = narrowed.matches.length === result.matches.length ? result : { status: narrowed.matches.length === 0 ? "none" as const : narrowed.matches.length === 1 && result.status !== "similar" ? "found" as const : result.status, matches: narrowed.matches };
      store.showLookup(name.trim(), fixed);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not search just now. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <CardShell title="Find a student" status="Search">
      <Field label="Student’s name" htmlFor={id}>
        <input id={id} data-ph-mask data-sentry-mask className={control} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
      </Field>
      {classHints.length > 0 && <p className="text-xs text-muted-foreground">Only matches in {classHints.map((c) => c.toUpperCase()).join(", ")} are shown.</p>}
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy || name.trim().length < 2} onClick={() => void search()}>
        {busy ? "Searching…" : "Search"}
      </button>
    </CardShell>
  );
}

const SECTION_LABEL: Record<StudentRecordSection, string> = { summary: "Summary", attendance: "Attendance this term", results: "Released results" };

/** A selected student's record: the sections an existing endpoint already serves to this person. */
export function StudentRecordCard({ studentId, section: initial }: { studentId: string; section: StudentRecordSection }) {
  const { state } = useAssistant();
  const entry = state.students.find((e) => e.studentId === studentId);
  const [section, setSection] = useState<StudentRecordSection>(initial);
  if (!entry) return <CardShell title="Student record"><Notice>This student is no longer in the conversation.</Notice></CardShell>;
  const m = entry.match;
  return (
    <CardShell title="Student record" status={SECTION_LABEL[section]}>
      <div data-ph-mask data-sentry-mask className="space-y-1">
        <p className="font-medium">{m.name}</p>
        <p className="text-xs text-muted-foreground">Admission no. {m.admissionNumber} · {m.classLabel ?? "No class this term"} · {m.status.toLowerCase()}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Record sections">
        {(["summary", "attendance", "results"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={section === s} className={`h-8 rounded-full px-3 text-xs ${section === s ? "bg-primary text-primary-foreground" : "bg-muted"}`} onClick={() => setSection(s)}>
            {SECTION_LABEL[s]}
          </button>
        ))}
      </div>
      {section === "summary" && <Link className="text-sm text-primary underline-offset-4 hover:underline" href={`/students/${studentId}`}>Open the student’s page</Link>}
      {section === "attendance" && <AttendanceSection studentId={studentId} armId={m.classArmId} termId={m.termId} />}
      {section === "results" && <ResultsSection studentId={studentId} armId={m.classArmId} termId={m.termId} />}
      <p className="text-xs text-muted-foreground">Behaviour, health and contact details are not shown here.</p>
    </CardShell>
  );
}

/** `undefined` while loading; then the endpoint's answer (`null`: nothing for this student). */
function useSection<T>(load: (() => Promise<T>) | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then((d) => { if (live) setData(d); }).catch((e) => {
      if (!live) return;
      setError(e instanceof ApiError && (e.status === 403 || e.status === 404) ? "Your account can’t see this section for this student." : "Could not load this just now.");
    });
    return () => { live = false; };
  }, [load]);
  return { data, error };
}

function AttendanceSection({ studentId, armId, termId }: { studentId: string; armId: string | null; termId: string | null }) {
  const [load] = useState(() => (armId && termId ? () => getSummary(armId, termId).then((r) => r.summary.find((x) => x.studentId === studentId) ?? null) : null));
  const { data, error } = useSection<AttendanceSummaryRowDto | null>(load);
  if (!armId || !termId) return <Notice>No class this term, so no attendance to show.</Notice>;
  if (error) return <Notice tone="warning">{error}</Notice>;
  if (data === undefined) return <p role="status" className="text-sm">Loading attendance…</p>;
  if (data === null) return <p className="text-sm">No attendance has been recorded for this student this term.</p>;
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm" data-ph-mask data-sentry-mask>
      <div><dt className="text-xs text-muted-foreground">Days marked</dt><dd>{data.daysMarked}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Attendance</dt><dd>{(data.attendanceRate / 100).toFixed(1)}%</dd></div>
      <div><dt className="text-xs text-muted-foreground">Present / late</dt><dd>{data.presentCount} / {data.lateCount}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Absent / excused</dt><dd>{data.absentCount} / {data.excusedCount}</dd></div>
    </dl>
  );
}

function ResultsSection({ studentId, armId, termId }: { studentId: string; armId: string | null; termId: string | null }) {
  // RELEASED cards only, through the report-card board's own status filter.
  const [load] = useState(() => (armId && termId ? () => getReportCardBoard(termId, armId, "RELEASED").then((r) => r.data.find((x) => x.student.id === studentId) ?? null) : null));
  const { data, error } = useSection<ReportCardBoardRowDto | null>(load);
  if (!armId || !termId) return <Notice>No class this term, so no results to show.</Notice>;
  if (error) return <Notice tone="warning">{error}</Notice>;
  if (data === undefined) return <p role="status" className="text-sm">Loading results…</p>;
  if (data === null) return <p className="text-sm">No released results for this student this term yet.</p>;
  const c = data.reportCard;
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm" data-ph-mask data-sentry-mask>
      <div><dt className="text-xs text-muted-foreground">Average</dt><dd>{c.overallAverage === null ? "—" : `${(c.overallAverage / 100).toFixed(2)}%`}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Position</dt><dd>{c.overallPosition ?? "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Subjects</dt><dd>{c.subjectsCount ?? "—"}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Released</dt><dd>{c.releasedAt ? String(c.releasedAt).slice(0, 10) : "—"}</dd></div>
    </dl>
  );
}
