"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { matchClassHints, type AssistantCapabilitiesDto, type BillingContextDto } from "@school-kit/types";

import { ApiError } from "@/lib/api-client";
import { invoiceRunApi } from "@/lib/assistant/api";
import { resolveTermHint } from "@/lib/assistant/hints";
import { InvoiceRunSession, type InvoicePhase } from "@/lib/assistant/invoice-session";
import type { AssistantTask, TaskStatus } from "@/lib/assistant/store";
import { formatKobo } from "@/lib/finance/format";

import { useAssistant } from "../assistant-provider";
import { ApproveControl, CardShell, Field, Notice, control } from "./common";

// Term invoices through the existing #512 service: an explicit term and class
// selection, the server’s preview (with its exceptions and totals), then a
// separate approval that the server re-checks. Figures are the server’s.

const status = (p: InvoicePhase): TaskStatus => (p === "approving" || p === "checking" ? "confirming" : p === "unknown" ? "uncertain" : p === "done" ? "done" : "active");

export function InvoiceCard({ task, caps }: { task: AssistantTask; caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  const session = store.session(task.id, () => {
    const s = new InvoiceRunSession(invoiceRunApi, (run) => store.updateTask(task.id, { ref: { runId: run.id } }));
    s.subscribe(() => store.updateTask(task.id, { status: status(s.snapshot().phase) }));
    return s;
  });
  const st = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [ctx, setCtx] = useState<BillingContextDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [termId, setTermId] = useState("");
  const [arms, setArms] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [checked, setChecked] = useState(false);
  const ids = { term: useId(), due: useId(), approve: useId() };

  useEffect(() => {
    let live = true;
    invoiceRunApi.context().then((c) => {
      if (!live) return;
      setCtx(c);
      setTermId((t) => t || resolveTermHint(c.terms, task.hints.term) || "");
      if (task.hints.classes?.length || task.hints.allClasses) {
        setArms((a) => a.length ? a : task.hints.allClasses ? c.arms.map((x) => x.id) : matchClassHints(task.hints.classes ?? [], c.arms).matched.map((x) => x.id));
      }
    }).catch((e) => { if (live) setLoadError(e instanceof ApiError ? e.message : "Could not load terms and classes."); });
    return () => { live = false; };
  }, [task.hints]);

  const unmatched = useMemo(() => (ctx && task.hints.classes ? matchClassHints(task.hints.classes, ctx.arms).unmatched : []), [ctx, task.hints.classes]);
  const run = st.run;
  const editing = st.phase === "idle" || st.phase === "prepare-error";

  if (loadError) return <CardShell title="Term invoices"><Notice tone="error">{loadError}</Notice></CardShell>;
  if (!ctx) return <CardShell title="Term invoices"><p role="status">Loading terms and classes…</p></CardShell>;

  return (
    <CardShell title="Term invoices" status={LABEL[st.phase]} tone={st.phase === "done" ? "done" : st.phase === "unknown" || st.phase === "stale" ? "warning" : "default"}>
      {editing && (
        <>
          <Field label="Term" htmlFor={ids.term}>
            <select id={ids.term} className={control} value={termId} onChange={(e) => setTermId(e.target.value)}>
              <option value="">Choose a term</option>
              {ctx.terms.map((t) => <option key={t.id} value={t.id}>{t.year} · {t.name}{t.isCurrent ? " (current)" : ""}</option>)}
            </select>
          </Field>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium">Classes ({arms.length} of up to 20)</legend>
            {unmatched.length > 0 && <Notice tone="warning">I couldn’t find {unmatched.join(", ")} among your classes. Tick the right ones below.</Notice>}
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
              {ctx.arms.map((a) => (
                <label key={a.id} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4" checked={arms.includes(a.id)} onChange={(e) => setArms((x) => e.target.checked ? [...x, a.id].slice(0, 20) : x.filter((y) => y !== a.id))} />
                  <span>{a.level} · {a.name}</span>
                </label>
              ))}
              {ctx.arms.length === 0 && <p className="text-muted-foreground">No active classes.</p>}
            </div>
          </fieldset>
          <Field label="Due date (optional)" htmlFor={ids.due}>
            <input id={ids.due} type="date" className={control} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          {st.message && <Notice tone="error">{st.message}</Notice>}
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={!termId || arms.length === 0}
            onClick={() => void session.prepare({ termId, classArmIds: arms, ...(dueDate ? { dueDate } : {}) })}
          >
            Show the server’s preview
          </button>
          <p className="text-xs text-muted-foreground">Previewing issues nothing.</p>
        </>
      )}
      {st.phase === "preparing" && <p role="status">Preparing the preview on the server…</p>}
      {run && !editing && st.phase !== "preparing" && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">{run.result ? "Issued" : "To issue"}</dt><dd className="text-lg font-semibold">{run.result?.created ?? run.createCount}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Already invoiced</dt><dd className="text-lg font-semibold">{run.result?.skipped ?? run.skipCount}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Total due</dt><dd className="text-sm font-semibold">{formatKobo(BigInt(run.result?.totalDueKobo ?? run.totalDueKobo))}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">{run.termLabel}{run.dueDate ? ` · due ${run.dueDate}` : ""}. Figures are the server’s.</p>
          <ul className="space-y-1">
            {run.arms.map((a) => (
              <li key={a.classArmId}>
                <details className="rounded-lg bg-muted/40 p-2">
                  <summary className="cursor-pointer">{a.label}: {a.createCount} new · {a.skipCount} skipped · {formatKobo(BigInt(a.totalDueKobo))}{a.missingFees ? " · no fees set" : ""}</summary>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {a.rows.map((r) => <li key={r.studentId} className="flex justify-between gap-2"><span>{r.studentName ?? "Student"}{r.admissionNumber ? ` · ${r.admissionNumber}` : ""}</span><span>{r.alreadyInvoiced ? "skip" : formatKobo(r.totalDue)}</span></li>)}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          {run.blockers.length > 0 && <Notice tone="warning">Fix first: {run.blockers.join("; ")}</Notice>}
        </>
      )}
      {st.phase === "review" && run && (
        caps.workflows.invoices.canApprove ? (
          <ApproveControl id={ids.approve} checked={checked} onChecked={setChecked} disabled={run.blockers.length > 0}
            statement={`I checked this preview: issue ${run.createCount} invoices for ${run.termLabel}.`} button="Approve and issue invoices" onApprove={() => void session.approve()} />
        ) : <Notice>Your account can preview but not issue invoices. Ask someone with permission to issue them.</Notice>
      )}
      {st.phase === "approving" && <p role="status">Issuing on the server…</p>}
      {(st.phase === "checking" || st.phase === "unknown" || st.phase === "stale") && st.message && <Notice tone="warning">{st.message}</Notice>}
      {st.phase === "unknown" && <button type="button" className="underline" onClick={() => void session.check()}>Check the original run again</button>}
      {st.phase === "stale" && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm font-medium" onClick={() => { setChecked(false); void session.refresh(); }}>Prepare a fresh preview</button>}
      {st.phase === "done" && run?.result && (
        <>
          <Notice tone="success">Done: {run.result.created} invoices issued, {run.result.skipped} already existed and were skipped.</Notice>
          <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/finance/invoices">Open invoices</Link>
        </>
      )}
    </CardShell>
  );
}

const LABEL: Record<InvoicePhase, string> = {
  idle: "Choosing", "prepare-error": "Not prepared", preparing: "Preparing", review: "Awaiting your approval", approving: "Issuing",
  checking: "Checking", unknown: "Outcome unconfirmed", stale: "Preview out of date", done: "Issued",
};
