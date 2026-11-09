"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { matchClassHints, type AssistantCapabilitiesDto, type DebtorDto, type ReminderSendOutcome, type TermDto } from "@school-kit/types";

import { SEND_LABELS } from "@/components/finance/reminders/durable-campaign";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { ApiError } from "@/lib/api-client";
import { resolveTermHint } from "@/lib/assistant/hints";
import type { AssistantTask, TaskStatus } from "@/lib/assistant/store";
import { listDebtors } from "@/lib/finance/finance-api";
import { formatKobo } from "@/lib/finance/format";
import { MAX_REMINDER_CAMPAIGN_STUDENTS, reminderAudience } from "@/lib/reminder-campaigns/audience";
import { DurableCampaignSession, type DurableState } from "@/lib/reminder-campaigns/durable-session";

import { useAssistant } from "../assistant-provider";
import { ApproveControl, CardShell, Field, Notice, control } from "./common";

// Fee-reminder campaigns through the durable #519 service, driven by the same
// session the Reminders page uses (#518). Segment debtors, review the
// server’s preview, confirm once, then follow the saved campaign: progress,
// quiet-hours holds, halt and explicit resume. UNKNOWN sends are shown as
// "may have been sent" and are never retried.

const status = (s: DurableState): TaskStatus =>
  s.phase === "confirming" || s.phase === "recovering" ? "confirming"
    : s.phase === "unknown" ? "uncertain"
      : s.campaign?.status === "COMPLETED" ? "done" : "active";

const ELIGIBILITY: Record<string, string> = {
  ELIGIBLE: "Will be reminded", NOT_FOUND: "Student unavailable", NO_BALANCE: "Nothing owed", ON_PAYMENT_PLAN: "On a payment plan",
  NOT_OVERDUE: "Not overdue", NO_GUARDIAN: "No linked guardian", NO_CONTACT: "No reachable contact",
};

export function ReminderCard({ task, caps }: { task: AssistantTask; caps: AssistantCapabilitiesDto }) {
  const { store } = useAssistant();
  const session = store.session(task.id, () => {
    const s = new DurableCampaignSession();
    s.subscribe(() => {
      const snap = s.snapshot();
      store.updateTask(task.id, { status: status(snap), ref: { ...(snap.proposal ? { proposalId: snap.proposal.id } : {}), ...(snap.campaignId ? { campaignId: snap.campaignId } : {}) } });
    });
    return s;
  });
  const st = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  return st.phase === "idle" ? <Selection task={task} session={session} /> : <Campaign session={session} st={st} canApprove={caps.workflows.reminders.canApprove} />;
}

function Selection({ task, session }: { task: AssistantTask; session: DurableCampaignSession }) {
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [rows, setRows] = useState<DebtorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [classArm, setClassArm] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(task.hints.overdueOnly ?? false);
  const [excludePlans, setExcludePlans] = useState(!task.hints.includePaymentPlans);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = { term: useId(), cls: useId() };

  useEffect(() => {
    let live = true;
    listAcademicYears()
      .then(async (years) => {
        const year = years.find((y) => y.isCurrent) ?? years[0];
        const t = year ? await listTerms(year.id) : [];
        if (!live) return;
        setTerms(t);
        setTermId((x) => x || resolveTermHint(t, task.hints.term) || "");
      })
      .catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load terms."); });
    return () => { live = false; };
  }, [task.hints.term]);

  useEffect(() => {
    let live = true;
    setRows(null); setSelected(new Set());
    if (termId) listDebtors(termId).then((d) => {
      if (!live) return;
      setRows(d);
      // A class named in the request preselects that class’s filter.
      if (task.hints.classes?.length) {
        const names = [...new Set(d.map((x) => x.classArm))].map((n) => ({ id: n, name: n, level: "" }));
        const hit = matchClassHints(task.hints.classes, names).matched[0];
        if (hit) setClassArm(hit.id);
      }
    }).catch((e) => { if (live) setError(e instanceof ApiError ? e.message : "Could not load debtors."); });
    return () => { live = false; };
  }, [termId, task.hints.classes]);

  const audience = useMemo(() => reminderAudience(rows ?? [], { search: "", classArm, risk: "", overdueOnly, excludePlans }), [rows, classArm, overdueOnly, excludePlans]);
  const classes = useMemo(() => [...new Set((rows ?? []).map((r) => r.classArm))].sort(), [rows]);
  const chosen = audience.filter((s) => selected.has(s.studentId));

  if (error) return <CardShell title="Fee reminders"><Notice tone="error">{error}</Notice></CardShell>;
  return (
    <CardShell title="Fee reminders" status="Choosing families">
      <Field label="Term" htmlFor={ids.term}>
        <select id={ids.term} className={control} value={termId} onChange={(e) => setTermId(e.target.value)}>
          <option value="">Choose a term</option>
          {terms.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? " (current)" : ""}</option>)}
        </select>
      </Field>
      {termId && rows === null && <p role="status">Loading students who owe…</p>}
      {rows && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Class" htmlFor={ids.cls}>
              <select id={ids.cls} className={control} value={classArm} onChange={(e) => { setClassArm(e.target.value); setSelected(new Set()); }}>
                <option value="">All classes</option>
                {classes.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div className="space-y-1 pt-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setSelected(new Set()); }} />Overdue only</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={excludePlans} onChange={(e) => { setExcludePlans(e.target.checked); setSelected(new Set()); }} />Leave out payment plans</label>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{audience.length} matching students · {chosen.length} selected</p>
            <button type="button" className="text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50" disabled={audience.length === 0} onClick={() => setSelected(new Set(audience.slice(0, MAX_REMINDER_CAMPAIGN_STUDENTS).map((s) => s.studentId)))}>Select all matching</button>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
            {audience.map((s) => (
              <li key={s.studentId}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selected.has(s.studentId)} onChange={(e) => setSelected((x) => { const n = new Set(x); if (e.target.checked) n.add(s.studentId); else n.delete(s.studentId); return n; })} />
                  <span className="min-w-0 flex-1"><span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· {s.admissionNumber} · {s.classArm}</span>
                    <span className="block text-xs text-muted-foreground">{s.invoices.map((i) => `${formatKobo(i.balance)} ${i.status === "OVERDUE" ? "overdue" : "owing"}`).join(", ")}</span></span>
                </label>
              </li>
            ))}
            {audience.length === 0 && <li className="text-muted-foreground">Nobody matches these filters.</li>}
          </ul>
          <button
            type="button"
            className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={chosen.length === 0}
            onClick={() => void session.start({ termId, studentIds: chosen.map((s) => s.studentId), options: { includePaymentPlans: !excludePlans, overdueOnly } })}
          >
            Show the server’s preview
          </button>
          <p className="text-xs text-muted-foreground">Previewing sends nothing. The server recalculates balances, plans and contacts.</p>
        </>
      )}
    </CardShell>
  );
}

function Campaign({ session, st, canApprove }: { session: DurableCampaignSession; st: DurableState; canApprove: boolean }) {
  const [checked, setChecked] = useState(false);
  const approveId = useId();
  const p = st.proposal;
  const c = st.campaign;

  // Follow a running campaign while this card is visible.
  useEffect(() => {
    if (st.phase !== "live" || c?.status !== "RUNNING") return;
    const t = window.setInterval(() => void session.check(), 5_000);
    return () => window.clearInterval(t);
  }, [st.phase, c?.status, session]);

  if (c) {
    const unknown = c.counts.UNKNOWN;
    return (
      <CardShell title="Fee reminder campaign" status={c.status === "RUNNING" ? (c.heldForQuietHours ? "Held for quiet hours" : "Sending") : c.status === "HALTED" ? "Halted" : "Finished"} tone={c.status === "COMPLETED" && unknown === 0 ? "done" : unknown > 0 || c.status === "HALTED" ? "warning" : "default"}>
        {c.heldForQuietHours && <Notice>It’s between 21:00 and 06:00 in Lagos. Sends wait until 06:00.</Notice>}
        {c.status === "HALTED" && <Notice tone="warning">Halted{c.haltReason ? `: ${c.haltReason.toLowerCase().replaceAll("_", " ")}` : ""}. Nothing more is sent unless you resume.</Notice>}
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(["ACCEPTED", "PENDING", "SKIPPED", "FAILED", "UNKNOWN", "NOT_REQUESTED"] as ReminderSendOutcome[]).map((k) => (
            <div key={k} className={k === "UNKNOWN" && c.counts[k] > 0 ? "rounded-lg bg-secondary/25 p-2" : "rounded-lg bg-muted p-2"}>
              <dt className="text-xs text-muted-foreground">{SEND_LABELS[k]}</dt><dd className="text-lg font-semibold">{c.counts[k]}</dd>
            </div>
          ))}
        </dl>
        {unknown > 0 && <Notice tone="warning">{unknown} {unknown === 1 ? "send" : "sends"} may have gone out: the provider’s answer was lost. These are never retried automatically; check with the family before sending again.</Notice>}
        <details className="rounded-lg bg-muted/40 p-2">
          <summary className="cursor-pointer">Per-family results ({c.students.length})</summary>
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto">
            {c.students.map((s) => (
              <li key={s.studentId}>
                <p className="font-medium">{s.name ?? "Student"}{s.admissionNumber ? ` · ${s.admissionNumber}` : ""}</p>
                <ul className="text-xs text-muted-foreground">
                  {s.sends.map((x, i) => <li key={i}>{x.slot === "EMAIL" ? "Email" : (x.channelUsed === "PUSH" ? "App alert" : x.channelUsed === "SMS" ? "SMS" : "App alert or SMS")}: {SEND_LABELS[x.outcome]}{x.reason ? ` (${x.reason.toLowerCase().replaceAll("_", " ")})` : ""}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </details>
        <p className="text-xs text-muted-foreground">{c.limits}</p>
        <div className="flex flex-wrap gap-2">
          {c.status === "RUNNING" && <button type="button" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" disabled={st.phase !== "live"} onClick={() => void session.act("halt")}>Halt campaign</button>}
          {c.status === "HALTED" && <button type="button" className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm" disabled={st.phase !== "live"} onClick={() => void session.act("resume")}>Resume (sends only what was never attempted)</button>}
          <button type="button" className="inline-flex h-9 items-center rounded-md px-3 text-sm underline" onClick={() => void session.check()}>Refresh status</button>
          <Link href="/finance/reminders" className="inline-flex h-9 items-center px-1 text-sm text-primary underline-offset-4 hover:underline">Open Reminders</Link>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell title="Fee reminders" status={st.phase === "review" ? "Awaiting your confirmation" : st.phase} tone={st.phase === "unknown" || st.phase === "refresh-needed" ? "warning" : "default"}>
      {(st.phase === "preparing" || st.phase === "refreshing" || st.phase === "recovering" || st.phase === "status-loading") && <p role="status">{st.message ?? "Working on the server…"}</p>}
      {p && st.phase !== "preparing" && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Selected</dt><dd className="text-lg font-semibold">{p.counts.selected}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Will be reminded</dt><dd className="text-lg font-semibold">{p.counts.eligible}</dd></div>
            <div className="rounded-lg bg-muted p-2"><dt className="text-xs text-muted-foreground">Planned sends</dt><dd className="text-lg font-semibold">{p.counts.plannedSends}</dd></div>
          </dl>
          <p className="text-xs text-muted-foreground">{p.termLabel} · email {p.channels.email.enabled && p.channels.email.configured ? "on" : "off"} · SMS {p.channels.sms.enabled && p.channels.sms.configured ? `on (${p.channels.sms.sender === "SCHOOL" ? "your sender name" : "SchoolKit sender"})` : "off"} · app alerts {p.channels.push.enabled ? "on" : "off"}</p>
          {[...p.batchErrors, ...p.batchWarnings].map((w) => <Notice key={w.code} tone={p.batchErrors.some((e) => e.code === w.code) ? "error" : "warning"}>{w.message}</Notice>)}
          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted/40 p-2">
            {p.students.map((s) => (
              <li key={s.studentId} className="flex justify-between gap-2">
                <span>{s.name ?? "Student unavailable"}{s.admissionNumber ? ` · ${s.admissionNumber}` : ""}</span>
                <span className="text-right text-xs">{s.eligibility === "ELIGIBLE" ? formatKobo(s.balance) : ELIGIBILITY[s.eligibility]}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{p.limits}</p>
        </>
      )}
      {st.message && st.phase !== "recovering" && st.phase !== "preparing" && <Notice tone={st.phase === "prepare-error" || st.phase === "refresh-error" || st.phase === "status-error" ? "error" : "warning"}>{st.message}</Notice>}
      {st.phase === "review" && p && (canApprove ? (
        <ApproveControl id={approveId} checked={checked} onChecked={setChecked} disabled={!p.canConfirm}
          statement={`I checked this preview: send reminders for ${p.counts.eligible} students in ${p.termLabel ?? "this term"}.`} button="Confirm and start sending" onApprove={() => void session.confirm()} />
      ) : <Notice>Your account can’t send reminders.</Notice>)}
      {st.phase === "confirming" && <p role="status">Confirming on the server…</p>}
      {(st.phase === "refresh-needed" || st.phase === "refresh-error") && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" onClick={() => { setChecked(false); void session.refresh(); }}>Refresh the preview</button>}
      {st.phase === "prepare-error" && <button type="button" className="inline-flex h-10 items-center rounded-md border border-input px-4 text-sm" onClick={() => void session.prepare()}>Try preparing again</button>}
      {(st.phase === "unknown" || st.phase === "status-error") && <button type="button" className="underline" onClick={() => void session.check()}>Check the original preview again</button>}
    </CardShell>
  );
}
