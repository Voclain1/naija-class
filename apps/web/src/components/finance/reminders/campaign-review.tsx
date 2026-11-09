"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api-client";
import { durableCampaignApi } from "@/lib/reminder-campaigns/durable-api";
import { DurableCampaignPanel } from "./durable-campaign";
import { reminderResultText } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isAuthForcedNavigation } from "@/lib/auth/session-end-navigation";
import { formatKobo } from "@/lib/finance/format";
import { ReminderCampaignSession, type CampaignRequest } from "@/lib/reminder-campaigns/session";

export function CampaignReview(props: { request: CampaignRequest; onClose: () => void }) {
  const [mode, setMode] = useState<"loading" | "on" | "off" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let cancelled = false; setMode("loading");
    void durableCampaignApi.available().then(({ enabled }) => { if (!cancelled) setMode(enabled === true ? "on" : enabled === false ? "off" : "error"); }).catch((e) => { if (!cancelled) setMode(e instanceof ApiError && e.status === 404 ? "off" : "error"); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (mode === "loading") return <p role="status">Checking saved campaign availability…</p>;
  if (mode === "error") return <div role="alert"><p>Could not check campaign availability. No reminders were requested.</p><Button onClick={() => setAttempt((n) => n + 1)}>Retry availability check</Button><Button variant="outline" onClick={props.onClose}>Cancel review</Button></div>;
  return mode === "on" ? <DurableCampaignPanel {...props} /> : <LegacyCampaignReview {...props} />;
}

function LegacyCampaignReview({ request, onClose }: { request: CampaignRequest; onClose: () => void }) {
  const [session, setSession] = useState<ReminderCampaignSession | null>(null);
  useEffect(() => { const s = new ReminderCampaignSession(); setSession(s); void s.open(request); return () => s.dispose(); }, [request]);
  return session ? <ReviewDialog session={session} termLabel={request.termLabel} canReadGuardians={!!request.canReadGuardians} excludePlans={request.filters.excludePlans} onClose={onClose} /> : null;
}

function ReviewDialog({ session, termLabel, canReadGuardians, excludePlans, onClose }: { session: ReminderCampaignSession; termLabel: string; canReadGuardians: boolean; excludePlans: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const [checked, setChecked] = useState(false);
  const canClose = ["review", "load-error", "done"].includes(state.phase);
  const close = () => { if (canClose) { session.close(); onClose(); } };
  const c = state.channels;
  const noChannel = c && !c.emailEnabled && !c.smsEnabled && !c.pushEnabled;
  useEffect(() => {
    if (!["sending", "uncertain"].includes(state.phase)) return;
    const warn = (event: BeforeUnloadEvent) => { if (isAuthForcedNavigation()) return; event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [state.phase]);
  const confirmed = state.batches.filter((b) => b.status === "confirmed");
  const sent = confirmed.reduce((n, b) => n + (b.result?.sent ?? 0), 0);
  const skipped = confirmed.reduce((n, b) => n + (b.result?.skipped ?? 0), 0);
  const waiting = state.batches.filter((b) => b.status === "waiting").reduce((n, b) => n + b.studentIds.length, 0);
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="ph-no-capture sm:max-w-4xl" data-sentry-mask onEscapeKeyDown={(e) => { if (!canClose) e.preventDefault(); }} onPointerDownOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{state.phase === "done" ? "Reminder run results" : state.phase === "uncertain" ? "Stop: the last send is unconfirmed" : "Review fee reminders"}</DialogTitle><DialogDescription>Term: {termLabel}. Counts refer to students, not unique families or individual email addresses.</DialogDescription></DialogHeader>
      {state.phase === "loading" && <p role="status">Rechecking outstanding invoices and the selected students…</p>}
      {state.message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{state.message}</p>}
      {state.phase !== "loading" && state.phase !== "load-error" && <>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-4">
          {[["Students in this run", state.recipients.length], ["Send requests", state.batches.length], ["No longer eligible", state.removed], ["Maximum per request", 50]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>)}
        </dl>
        {state.phase === "review" && <section className="space-y-2 text-sm" aria-label="Delivery settings and reminder content">
          <h3 className="font-semibold">How this reminder works</h3>
          <p>{excludePlans ? "Students with payment plans are excluded from this run." : "You have chosen to include students with payment plans."}</p>
          <p>The standard fee reminder names the child and term, quotes the outstanding balance calculated by the server, and includes the school’s available payment options. This screen does not edit the message.</p>
          <p>Email goes to eligible linked guardians. One linked guardian may receive an app alert or SMS, following the existing delivery rules. Siblings can generate separate reminders. SMS availability and charges depend on the school’s provider setup.</p>
          {c ? <p><strong>Enabled in school settings:</strong> Email {c.emailEnabled ? "on" : "off"} · SMS {c.smsEnabled ? "on" : "off"} · App alerts {c.pushEnabled ? "on" : "off"}. These settings do not verify provider availability or each guardian’s contact details.</p> : <p>Your account cannot view notification settings here. The server applies the school’s settings when sending; ask an administrator if you need to check them first.</p>}
          {noChannel && <p role="alert" className="font-medium text-destructive">All channels are off. An administrator must enable a channel before this review can be sent.</p>}
          <p>Invoices and payment plans were rechecked for this review. A payment plan added afterwards may still receive a reminder: go back and review again if an arrangement changes. SchoolKit checks current balances when sending. Already delivered reminders cannot be recalled. Run results are kept only while this page is open. There is no automatic retry.</p>
        </section>}
        {state.recipients.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><caption className="sr-only">Students approved for fee reminders</caption><thead className="sticky top-0 bg-card"><tr>{["Student", "Class", "Outstanding invoice balances"].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead><tbody>{state.recipients.map((s) => <tr key={s.studentId} className="border-t"><td className="min-w-36 p-2"><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.admissionNumber}</p></td><td className="p-2">{s.classArm}</td><td className="min-w-40 p-2">{s.invoices.map((i) => <p key={i.invoiceId}>{i.supplementary ? "Supplementary" : "Term"}: {formatKobo(i.balance)} {i.hasPaymentPlan ? "· payment plan" : ""}</p>)}</td></tr>)}</tbody></table></div>}
        {state.phase === "review" && !state.recipients.length && <p role="status">None of the selected students still match this run. Nothing will be sent.</p>}
        {state.phase !== "review" && <section aria-label="Run results" className="space-y-3 text-sm">
          <p role="status"><strong>{sent}</strong> students with a confirmed send result · <strong>{skipped}</strong> skipped in confirmed batches · <strong>{waiting}</strong> not requested.</p>
          <ol className="space-y-2">{state.batches.map((b, i) => <li key={i} className="rounded-lg bg-muted/50 p-3"><p className="font-medium">Batch {i + 1} · {b.studentIds.length} students · {b.status === "confirmed" ? "Result received" : b.status === "uncertain" ? "Outcome unknown" : b.status === "sending" ? "Sending…" : "Not requested"}</p>{b.result && <p>{reminderResultText(b.result)}</p>}</li>)}</ol>
          <p>Results are reported for each batch. They do not confirm that a parent received or read a message, and do not identify individual skipped students.</p>
        </section>}
        {state.phase === "review" && !!state.recipients.length && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked the term, student list and delivery information, and approve this reminder run.</label>}
      </>}
      <div className="flex flex-wrap gap-3 text-sm">{canReadGuardians ? <Link href="/guardians" target="_blank" rel="noopener noreferrer" className="underline">Open guardian records</Link> : <span>Ask an administrator to correct missing guardian details.</span>}{c && <Link href="/settings/notifications" target="_blank" rel="noopener noreferrer" className="underline">Open notification settings</Link>}</div>
      <DialogFooter className="gap-2">
        {canClose && <Button type="button" variant="outline" onClick={close}>{state.phase === "done" ? "Close results" : "Back to selection"}</Button>}
        {state.phase === "load-error" && <Button type="button" onClick={() => void session.load()}>Retry review</Button>}
        {state.phase === "review" && <Button type="button" disabled={!checked || !state.recipients.length || !!noChannel} onClick={() => void session.send()}>Confirm and send reminders</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
