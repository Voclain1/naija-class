"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import type { AssistantCapabilitiesDto } from "@school-kit/types";

import { PlacementPicker, type PlacementValue } from "@/components/students/placement-picker";
import { IntakeTask, parsePastedRows, type PastedRow } from "@/lib/assistant/intake-task";
import type { AssistantTask, TaskStatus } from "@/lib/assistant/store";
import { validIntakeDate } from "@/lib/students/intake-review";

import { useAssistant } from "../assistant-provider";
import { ApproveControl, CardShell, Field, IN_FLIGHT_PHASES, Notice, PlanChangedNotice, control, useApprovalGate } from "./common";

// Add and enrol students through the reviewed intake service (#517/#514).
// Rows are typed or pasted into structured fields IN THE BROWSER and go only
// to the intake API; the server’s preview (identities, numbers, placement,
// warnings) is what the person confirms.

const empty = (): PastedRow => ({ firstName: "", lastName: "", dateOfBirth: "", gender: "", admissionNumber: "" });
const ready = (r: PastedRow) => r.firstName.trim() && r.lastName.trim() && validIntakeDate(r.dateOfBirth) && r.gender;

export function IntakeCard({ task, caps }: { task: AssistantTask; caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  const it = store.session(task.id, () => {
    const t = new IntakeTask();
    t.subscribe(() => {
      const s = t.snapshot();
      const p = s.session.phase;
      const next: TaskStatus = s.outcome ? "done" : p === "confirming" || p === "checking" ? "confirming" : p === "unknown" ? "uncertain" : "active";
      store.updateTask(task.id, { status: next, ...(s.session.proposal ? { ref: { proposalId: s.session.proposal.id } } : {}) });
    });
    return t;
  });
  const st = useSyncExternalStore(it.subscribe, it.snapshot, it.snapshot);
  useEffect(() => { store.reportTask(task.id, { stage: st.started && !st.outcome ? "review" : "editing" }); }, [store, task.id, st.started, st.outcome]);
  // A model plan revising this task while its preview shows: the preview is
  // out of date. Start a fresh session (the typed rows are kept in the task's
  // memory) so the old preview can never be confirmed. Never while a save is in
  // flight, its outcome open, or done.
  const phase = st.session.phase;
  useEffect(() => {
    if (store.planPending(task.id) && st.started && !st.outcome && !IN_FLIGHT_PHASES.has(phase)) store.resetSession(task.id);
  }, [store, task.id, task.revision, st.started, st.outcome, phase]);
  if (st.outcome) {
    return (
      <CardShell title="Add and enrol students" status="Saved" tone="done">
        <Notice tone="success">Saved {st.outcome.createdCount} {st.outcome.createdCount === 1 ? "student" : "students"}{st.outcome.enrolledCount ? `, ${st.outcome.enrolledCount} placed in their class` : ""}. No invitations were sent.</Notice>
        <ul className="space-y-1">{st.outcome.students.map((s) => <li key={s.studentId}><Link className="text-primary underline-offset-4 hover:underline" href={`/students/${s.studentId}`}>Admission no. {s.admissionNumber}</Link></li>)}</ul>
      </CardShell>
    );
  }
  return st.started ? <Review task={task} it={it} canApprove={caps.workflows.intake.canApprove} /> : <Editor task={task} it={it} />;
}

function Editor({ task, it }: { task: AssistantTask; it: IntakeTask }) {
  const { store } = useAssistant();
  // The task's memory (not the session's): it survives a session reset.
  const saved = store.memo<IntakeTask["draft"]>(task.id, "intakeDraft", () => it.draft);
  const [rows, setRows] = useState<PastedRow[]>(() => saved?.rows ?? Array.from({ length: Math.min(Math.max(task.hints.studentCount ?? 1, 1), 10) }, empty));
  const [paste, setPaste] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementValue | null | undefined>(saved?.placement);
  const pasteId = useId();
  const set = (i: number, patch: Partial<PastedRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const filled = rows.filter((r) => r.firstName || r.lastName || r.dateOfBirth || r.gender || r.admissionNumber);
  const valid = filled.length > 0 && filled.every(ready);

  // A model plan, or rows pasted into the chat (which never reach the model):
  // applied once per revision. The rows stay in this browser's memory.
  useEffect(() => {
    const plan = task.plan;
    if (plan?.kind !== "intake" || store.appliedRevision(task.id) >= task.revision) return;
    if (plan.pasted) {
      const { rows: parsed, skipped } = parsePastedRows(plan.pasted);
      if (parsed.length) setRows(parsed.slice(0, 200));
      setPasteNote(`${parsed.length} rows read${skipped ? `, ${skipped} skipped (header or incomplete)` : ""}. Check them below.`);
    }
    if (plan.placeLater) setPlacement(null);
    else if (plan.termId && plan.classArmId) setPlacement({ termId: plan.termId, classArmId: plan.classArmId });
    store.markApplied(task.id, task.revision);
  }, [task.plan, task.revision, store, task.id]);

  // Memory only: keeps what was typed across navigation, and tells the turn how many rows (a count, never content).
  useEffect(() => {
    it.draft = { rows, placement };
    store.setMemo(task.id, "intakeDraft", it.draft);
    store.reportTask(task.id, { scope: { termId: placement?.termId ?? null, classArmIds: placement ? [placement.classArmId] : [], placeLater: placement === null, studentCount: filled.length } });
  }, [it, rows, placement, store, task.id, filled.length]);

  return (
    <CardShell title="Add and enrol students" status="Entering students">
      <details className="rounded-lg bg-muted/40 p-2">
        <summary className="cursor-pointer text-sm font-medium">Paste rows from a spreadsheet</summary>
        <Field label="One student per line: first name, last name, date of birth, gender, admission no. (optional)" htmlFor={pasteId}>
          <textarea id={pasteId} data-ph-mask data-sentry-mask className={control} rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} />
        </Field>
        <button type="button" className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => {
          const { rows: parsed, skipped } = parsePastedRows(paste);
          if (parsed.length) setRows(parsed.slice(0, 200));
          setPasteNote(`${parsed.length} rows read${skipped ? `, ${skipped} skipped (header or incomplete)` : ""}. Check them below.`);
          setPaste("");
        }}>Use these rows</button>
        {pasteNote && <p className="mt-1 text-xs text-muted-foreground" role="status">{pasteNote}</p>}
      </details>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} className="space-y-2 rounded-lg bg-muted/40 p-2">
            <p className="text-xs font-medium text-muted-foreground">Student {i + 1}</p>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label={`Student ${i + 1} first name`} className={control} placeholder="First name" value={r.firstName} onChange={(e) => set(i, { firstName: e.target.value })} />
              <input aria-label={`Student ${i + 1} last name`} className={control} placeholder="Last name" value={r.lastName} onChange={(e) => set(i, { lastName: e.target.value })} />
              <input aria-label={`Student ${i + 1} date of birth`} type="date" className={control} value={r.dateOfBirth} onChange={(e) => set(i, { dateOfBirth: e.target.value })} />
              <select aria-label={`Student ${i + 1} gender`} className={control} value={r.gender} onChange={(e) => set(i, { gender: e.target.value as PastedRow["gender"] })}>
                <option value="">Gender</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option>
              </select>
              <input aria-label={`Student ${i + 1} admission number (optional)`} className={`${control} col-span-2`} placeholder="Admission no. (blank: assigned if automatic)" value={r.admissionNumber} onChange={(e) => set(i, { admissionNumber: e.target.value })} />
            </div>
            {rows.length > 1 && <button type="button" className="text-xs underline" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove student {i + 1}</button>}
          </li>
        ))}
      </ol>
      <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50" disabled={rows.length >= 200} onClick={() => setRows((x) => [...x, empty()])}>Add another student</button>
      <div className="rounded-lg bg-muted/40 p-2">
        <p className="mb-2 text-xs font-medium">Where do they go?</p>
        <PlacementPicker value={placement} onChange={setPlacement} onUnavailable={() => setPlacement(null)} requireExplicitTerm />
      </div>
      {filled.length > 0 && !valid && <Notice>Each student needs a first and last name, a real date of birth and a gender.</Notice>}
      <button
        type="button"
        className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        disabled={!valid || placement === undefined}
        onClick={() => { it.draft = { rows, placement }; it.start({
          placement: placement ? { mode: "ENROL", termId: placement.termId, classArmId: placement.classArmId } : { mode: "DEFER" },
          students: filled.map((r) => ({ firstName: r.firstName.trim(), lastName: r.lastName.trim(), dateOfBirth: new Date(`${r.dateOfBirth}T00:00:00.000Z`), gender: r.gender as "MALE" | "FEMALE" | "OTHER", ...(r.admissionNumber.trim() ? { admissionNumber: r.admissionNumber.trim() } : {}) })),
        }); }}
      >
        Show the server’s preview
      </button>
      <p className="text-xs text-muted-foreground">Previewing saves nothing. For long lists, the <Link className="underline" href="/students/intake">Student intake page</Link> has a full grid and file import.</p>
    </CardShell>
  );
}

function Review({ task, it, canApprove }: { task: AssistantTask; it: IntakeTask; canApprove: boolean }) {
  const st = useSyncExternalStore(it.subscribe, it.snapshot, it.snapshot).session;
  const gate = useApprovalGate(task.id);
  const [checked, setChecked] = useState(false);
  const approveId = useId();
  const p = st.proposal;
  return (
    <CardShell title="Add and enrol students" status={st.phase === "review" ? "Awaiting your confirmation" : st.phase} tone={st.phase === "unknown" || st.phase === "refresh-needed" ? "warning" : "default"}>
      {(st.phase === "preparing" || st.phase === "refreshing") && <p role="status">Preparing the preview on the server…</p>}
      {p && (
        <>
          <p className="text-sm">{p.placement.mode === "ENROL" ? `Into ${p.placement.classLabel ?? "the chosen class"} for ${p.placement.termLabel ?? "the chosen term"}` : "Placement decided later (no class)"} · {p.counts.rows} students{p.counts.assignedOnConfirm ? ` · ${p.counts.assignedOnConfirm} admission numbers assigned on save` : ""}</p>
          {[...p.batchErrors, ...p.batchWarnings].map((w) => <Notice key={w.code} tone={p.batchErrors.some((e) => e.code === w.code) ? "error" : "warning"}>{w.message}</Notice>)}
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
            {p.rows.map((r) => (
              <li key={r.index}>
                <p><span className="font-medium">{r.values.firstName} {r.values.lastName}</span> <span className="text-muted-foreground">· {r.values.dateOfBirth} · {r.admissionNumber ?? "number on save"}</span></p>
                {[...r.errors, ...r.warnings].map((x) => <p key={x.code} className={r.errors.includes(x as never) ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{x.message}</p>)}
              </li>
            ))}
          </ul>
          {p.counts.withWarnings > 0 && <p className="text-xs text-muted-foreground">{p.duplicateRule}</p>}
        </>
      )}
      {st.message && <Notice tone={st.phase === "prepare-error" || st.phase === "refresh-error" ? "error" : "warning"}>{st.message}</Notice>}
      {gate.pending && <PlanChangedNotice />}
      {st.phase === "review" && p && (canApprove ? (
        <ApproveControl id={approveId} checked={checked} onChecked={setChecked} disabled={!p.canConfirm || !gate.canApprove}
          statement={`I checked these ${p.counts.rows} students and where they go.`} button="Confirm and save students" onApprove={() => gate.approve(() => it.session.confirm())} />
      ) : <Notice>Your account can’t save students.</Notice>)}
      {st.phase === "confirming" && <p role="status">Saving on the server…</p>}
      {(st.phase === "refresh-needed" || st.phase === "refresh-error") && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" onClick={() => { setChecked(false); void it.session.refresh(); }}>Refresh the preview</button>}
      {st.phase === "unknown" && <button type="button" className="underline" onClick={() => void it.session.check()}>Check the original intake again</button>}
      {st.phase === "prepare-error" && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" onClick={() => void it.session.prepare()}>Try again</button>}
      {(st.phase === "review" || st.phase === "prepare-error") && <button type="button" className="text-xs underline" onClick={() => it.session.cancel()}>Back to editing</button>}
    </CardShell>
  );
}
