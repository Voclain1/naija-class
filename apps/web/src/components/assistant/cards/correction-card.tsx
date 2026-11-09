"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  MAX_STUDENT_CORRECTIONS,
  type AssistantCapabilitiesDto,
  type PrepareStudentCorrectionsInput,
  type StudentCorrectionField,
  type StudentDto,
} from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { CorrectionSession, type CorrectionPhase } from "@/lib/assistant/correction-session";
import { correctionApi } from "@/lib/assistant/api";
import type { AssistantTask, TaskStatus } from "@/lib/assistant/store";
import { listStudents } from "@/lib/students/students-api";

import { useAssistant } from "../assistant-provider";
import { ApproveControl, CardShell, Field, Notice, control } from "./common";

// Reviewed corrections through the #520 service: find each student with the
// roster search (by id from then on, never by name), change only the six
// supported fields, and confirm the server’s before/after. An empty field is
// "unchanged"; clearing the middle name or email is its own explicit choice.

type Mode = "keep" | "set" | "clear";
interface Edit { mode: Mode; value: string }
interface Picked { id: string; label: string; current: Record<StudentCorrectionField, string | null>; edits: Partial<Record<StudentCorrectionField, Edit>> }

const FIELDS: { field: StudentCorrectionField; label: string; optional: boolean; type: "text" | "date" | "gender" | "email" }[] = [
  { field: "firstName", label: "First name", optional: false, type: "text" },
  { field: "middleName", label: "Middle name", optional: true, type: "text" },
  { field: "lastName", label: "Last name", optional: false, type: "text" },
  { field: "dateOfBirth", label: "Date of birth", optional: false, type: "date" },
  { field: "gender", label: "Gender", optional: false, type: "gender" },
  { field: "email", label: "Email", optional: true, type: "email" },
];
const HINT_FIELDS: Record<string, StudentCorrectionField[]> = { name: ["firstName", "lastName"], dateOfBirth: ["dateOfBirth"], gender: ["gender"], email: ["email"] };

/** Memory only, per task session (which outlives the card across navigation): picked students, planned fields, applied plan revision. */
const picksOf = new WeakMap<object, Picked[]>();
const plannedOf = new WeakMap<object, StudentCorrectionField[]>();
const applied = new WeakMap<object, number>();

const status = (p: CorrectionPhase): TaskStatus => (p === "confirming" || p === "checking" ? "confirming" : p === "unknown" ? "uncertain" : p === "done" ? "done" : "active");

export function CorrectionCard({ task, caps }: { task: AssistantTask; caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  const session = store.session(task.id, () => {
    const s = new CorrectionSession(correctionApi, () => crypto.randomUUID(), (p) => store.updateTask(task.id, { ref: { proposalId: p.id } }));
    s.subscribe(() => store.updateTask(task.id, { status: status(s.snapshot().phase) }));
    return s;
  });
  const st = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const editing = st.phase === "idle" || (st.phase === "prepare-error" && !st.proposal);
  useEffect(() => { store.reportTask(task.id, { stage: editing ? "editing" : "review" }); }, [store, task.id, editing]);
  if (editing) return <Editor task={task} session={session} error={st.message} />;
  return <Review session={session} canApprove={caps.workflows.corrections.canApprove} />;
}

function currentOf(s: StudentDto): Picked["current"] {
  const dob = typeof s.dateOfBirth === "string" ? s.dateOfBirth.slice(0, 10) : new Date(s.dateOfBirth).toISOString().slice(0, 10);
  return { firstName: s.firstName, middleName: s.middleName ?? null, lastName: s.lastName, dateOfBirth: dob, gender: s.gender, email: s.email ?? null };
}

function Editor({ task, session, error }: { task: AssistantTask; session: CorrectionSession; error: string | null }) {
  const { store } = useAssistant();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentDto[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>(() => picksOf.get(session) ?? []);
  const [planned, setPlanned] = useState<StudentCorrectionField[]>(() => plannedOf.get(session) ?? []);
  const searchId = useId();
  const initial = [...new Set([...(task.hints.fields ?? []).flatMap((f) => HINT_FIELDS[f] ?? []), ...planned])];

  // A model plan: which fields to change, for the students already picked and
  // those picked next. The new values are typed here, never in the chat.
  useEffect(() => {
    const plan = task.plan;
    if (plan?.kind !== "corrections" || applied.get(session) === task.revision) return;
    applied.set(session, task.revision);
    setPlanned(plan.fields);
    setPicked((x) => x.map((p) => {
      const edits = { ...p.edits };
      for (const f of plan.fields) if (!edits[f] || edits[f]!.mode === "keep") edits[f] = { mode: "set", value: p.current[f] ?? "" };
      return { ...p, edits };
    }));
  }, [task.plan, task.revision, session]);

  useEffect(() => {
    picksOf.set(session, picked);
    plannedOf.set(session, planned);
    store.reportTask(task.id, { scope: { fields: initial, studentCount: picked.length } });
  }, [session, picked, planned, store, task.id, initial.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roster search through the existing, permission-checked students API.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults(null); return; }
    let live = true;
    const t = window.setTimeout(() => {
      listStudents({ search: q, limit: 8 }).then((r) => { if (live) { setResults(r.data); setSearchError(null); } })
        .catch((e) => { if (live) setSearchError(e instanceof ApiError ? e.message : "Search failed."); });
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [query]);

  function pick(s: StudentDto) {
    if (picked.some((p) => p.id === s.id) || picked.length >= MAX_STUDENT_CORRECTIONS) return;
    const current = currentOf(s);
    const edits: Picked["edits"] = {};
    for (const f of initial) edits[f] = { mode: "set", value: current[f] ?? "" };
    setPicked((x) => [...x, { id: s.id, label: `${s.firstName} ${s.lastName} · ${s.admissionNumber}`, current, edits }]);
    setQuery(""); setResults(null);
  }
  const setEdit = (id: string, field: StudentCorrectionField, edit: Edit) =>
    setPicked((x) => x.map((p) => (p.id === id ? { ...p, edits: { ...p.edits, [field]: edit } } : p)));

  const corrections: PrepareStudentCorrectionsInput["corrections"] = picked.flatMap((p) => {
    const changes: Record<string, string | null> = {};
    for (const { field } of FIELDS) {
      const e = p.edits[field];
      if (!e || e.mode === "keep") continue;
      if (e.mode === "clear") changes[field] = null;
      else if (e.value.trim()) changes[field] = e.value.trim();
    }
    return Object.keys(changes).length ? [{ studentId: p.id, changes: changes as PrepareStudentCorrectionsInput["corrections"][number]["changes"] }] : [];
  });

  return (
    <CardShell title="Correct student records" status="Choosing students">
      <Field label="Find a student (name or admission number)" htmlFor={searchId}>
        <input id={searchId} data-ph-mask data-sentry-mask className={control} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </Field>
      {searchError && <Notice tone="error">{searchError}</Notice>}
      {results && (
        <ul className="space-y-1 rounded-lg bg-muted/40 p-2" aria-label="Matching students">
          {results.map((s) => (
            <li key={s.id}><button type="button" className="w-full rounded-md px-2 py-1 text-left hover:bg-accent disabled:opacity-50" disabled={picked.some((p) => p.id === s.id)} onClick={() => pick(s)}>{s.firstName} {s.lastName} · {s.admissionNumber}</button></li>
          ))}
          {results.length === 0 && <li className="text-muted-foreground">No students match.</li>}
        </ul>
      )}
      {picked.map((p) => (
        <fieldset key={p.id} className="space-y-2 rounded-lg bg-muted/40 p-2">
          <legend className="text-sm font-medium">{p.label}</legend>
          {FIELDS.map(({ field, label, optional, type }) => {
            const e = p.edits[field] ?? { mode: "keep" as Mode, value: "" };
            return (
              <div key={field} className="space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="w-28 font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">Now: {p.current[field] ?? "(blank)"}</span>
                </div>
                <div className="flex flex-wrap gap-3 text-xs" role="radiogroup" aria-label={`${label} for ${p.label}`}>
                  <label className="flex items-center gap-1"><input type="radio" checked={e.mode === "keep"} onChange={() => setEdit(p.id, field, { mode: "keep", value: "" })} />Keep</label>
                  <label className="flex items-center gap-1"><input type="radio" checked={e.mode === "set"} onChange={() => setEdit(p.id, field, { mode: "set", value: p.current[field] ?? "" })} />Change</label>
                  {optional && <label className="flex items-center gap-1"><input type="radio" checked={e.mode === "clear"} disabled={!p.current[field]} onChange={() => setEdit(p.id, field, { mode: "clear", value: "" })} />Clear it</label>}
                </div>
                {e.mode === "set" && (type === "gender" ? (
                  <select aria-label={`New ${label.toLowerCase()} for ${p.label}`} className={control} value={e.value} onChange={(ev) => setEdit(p.id, field, { mode: "set", value: ev.target.value })}>
                    <option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
                  </select>
                ) : (
                  <input aria-label={`New ${label.toLowerCase()} for ${p.label}`} data-ph-mask data-sentry-mask type={type === "date" ? "date" : type === "email" ? "email" : "text"} className={control} value={e.value} onChange={(ev) => setEdit(p.id, field, { mode: "set", value: ev.target.value })} />
                ))}
              </div>
            );
          })}
          <button type="button" className="text-xs underline" onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}>Remove this student</button>
        </fieldset>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
      <button
        type="button"
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        disabled={corrections.length === 0}
        onClick={() => void session.prepare(corrections)}
      >
        Show the server’s before and after
      </button>
      <p className="text-xs text-muted-foreground">Only names, date of birth, gender and email can be corrected here. Previewing changes nothing.</p>
    </CardShell>
  );
}

function Review({ session, canApprove }: { session: CorrectionSession; canApprove: boolean }) {
  const st = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [checked, setChecked] = useState(false);
  const approveId = useId();
  const p = st.proposal;
  return (
    <CardShell title="Correct student records" status={LABEL[st.phase]} tone={st.phase === "done" ? "done" : st.phase === "unknown" || st.phase === "refresh-needed" ? "warning" : "default"}>
      {(st.phase === "preparing" || st.phase === "refreshing" || st.phase === "checking") && <p role="status">{st.message ?? "Working on the server…"}</p>}
      {st.phase === "done" && p?.outcome && (
        <>
          <Notice tone="success">Applied: {p.outcome.updatedCount} {p.outcome.updatedCount === 1 ? "record" : "records"} corrected.</Notice>
          <ul className="space-y-1">{p.outcome.students.map((s) => <li key={s.studentId}><Link className="text-primary underline-offset-4 hover:underline" href={`/students/${s.studentId}`}>Open student</Link> <span className="text-xs text-muted-foreground">({s.changed.join(", ")})</span></li>)}</ul>
        </>
      )}
      {p && st.phase !== "done" && p.rows.length > 0 && (
        <ul className="space-y-2">
          {p.rows.map((r) => (
            <li key={r.studentId} className="rounded-lg bg-muted/40 p-2">
              <p className="font-medium">{r.current ? `${r.current.name} · ${r.current.admissionNumber}` : "Student not found"}</p>
              <table className="mt-1 w-full text-left text-xs">
                <thead><tr><th className="py-1 pr-2 font-medium">Field</th><th className="py-1 pr-2 font-medium">Now</th><th className="py-1 font-medium">After</th></tr></thead>
                <tbody>
                  {r.fields.map((f) => (
                    <tr key={f.field}><td className="py-1 pr-2">{FIELDS.find((x) => x.field === f.field)?.label}</td><td className="py-1 pr-2">{f.before ?? "(blank)"}</td>
                      <td className="py-1">{f.change === "CLEAR" ? <span className="font-medium">Will be cleared</span> : f.change === "SAME" ? <span className="text-muted-foreground">No change</span> : <span className="font-medium">{f.after}</span>}</td></tr>
                  ))}
                </tbody>
              </table>
              {[...r.errors, ...r.warnings].map((x) => <p key={x.code} className="mt-1 text-xs">{x.message}</p>)}
            </li>
          ))}
        </ul>
      )}
      {p && st.phase !== "done" && p.batchErrors.map((e) => <Notice key={e.code} tone="error">{e.message}</Notice>)}
      {st.message && !["preparing", "refreshing", "checking"].includes(st.phase) && <Notice tone={st.phase === "refresh-error" || st.phase === "prepare-error" ? "error" : "warning"}>{st.message}</Notice>}
      {st.phase === "review" && p && (canApprove ? (
        <ApproveControl id={approveId} checked={checked} onChecked={setChecked} disabled={!p.canConfirm}
          statement={`I checked the before and after for ${p.counts.toUpdate} ${p.counts.toUpdate === 1 ? "student" : "students"}.`} button="Confirm corrections" onApprove={() => void session.confirm()} />
      ) : <Notice>Your account can’t apply corrections.</Notice>)}
      {st.phase === "confirming" && <p role="status">Applying on the server…</p>}
      {(st.phase === "refresh-needed" || st.phase === "refresh-error") && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" onClick={() => { setChecked(false); void session.refresh(); }}>Refresh with current records</button>}
      {st.phase === "unknown" && <button type="button" className="underline" onClick={() => void session.check()}>Check the original corrections again</button>}
    </CardShell>
  );
}

const LABEL: Record<CorrectionPhase, string> = {
  idle: "Choosing", preparing: "Preparing", "prepare-error": "Not prepared", review: "Awaiting your confirmation", confirming: "Applying",
  checking: "Checking", unknown: "Outcome unconfirmed", "refresh-needed": "Records changed", refreshing: "Refreshing", "refresh-error": "Refresh failed", done: "Applied",
};
