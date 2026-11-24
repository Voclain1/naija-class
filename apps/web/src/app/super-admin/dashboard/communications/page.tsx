"use client";

import { useRef, useState } from "react";
import type { MessagingPlatformControls, MessagingReconciliationReport, PaystackPaymentExceptionStatus, PaystackWebhookDeadLetterPage, PlatformAdminSchoolDto } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { ConsoleHeading } from "@/components/super-admin/console-shell";
import { usePlatformLoad } from "@/components/super-admin/platform-load";
import { ApiError, proxyFetch } from "@/lib/api-client";
import { formatKobo } from "@/lib/finance/format";

type Exception = { reference: string; invoiceId: string | null; reason: string; expectedKobo: string | null; observedKobo: string | null; observedCurrency: string | null; unappliedKobo: string | null; createdAt: string; reviewStatus: PaystackPaymentExceptionStatus; reviewedAt: string | null };
type TopUp = { reference: string; reconciliationCode: string | null; amountKobo: string; recoveryAttempts: number; createdAt: string };
const base = "/api/platform-admin";
const panel = "space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-6";
const inputStyle = "w-full rounded-xl border bg-background px-3 py-2 text-sm";
const money = (value: string | null) => value === null ? "Not established" : formatKobo(BigInt(value));
const display = (value: string) => value.toLowerCase().replaceAll("_", " ");
const timestamp = (value: string) => new Date(value).toLocaleString("en-NG", { timeZone: "Africa/Lagos" });

function EvidenceAction({ label, path, body, onDone, confirmation }: { label: string; path: string; body?: Record<string, unknown>; onDone: () => void; confirmation: string }) {
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const valid = /^[A-Za-z0-9._/-]{1,120}$/.test(evidence);
  async function run() {
    if (!valid || lock.current || !window.confirm(confirmation)) return;
    lock.current = true; setBusy(true); setFeedback(""); setFailed(false);
    try {
      await proxyFetch(path, { method: "POST", body: JSON.stringify({ ...body, evidenceRef: evidence }) });
      setFeedback("Request accepted. Review the refreshed record for the actual outcome.");
      setEvidence(""); onDone();
    } catch (e) { setFailed(true); setFeedback(e instanceof ApiError ? e.message : "Outcome uncertain. Refresh the record before repeating this action."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-2 rounded-xl border p-3"><label className="block space-y-1 text-xs"><span>Evidence reference — no secrets or personal details</span><input className={inputStyle} value={evidence} maxLength={120} disabled={busy} onChange={(e) => setEvidence(e.target.value)} placeholder="case-1234" /></label><Button size="sm" variant="outline" disabled={busy || !valid} onClick={() => void run()}>{busy ? "Working…" : label}</Button>{feedback && <p role={failed ? "alert" : "status"} className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{feedback}</p>}</div>;
}

function LoadState({ loading, error, empty }: { loading: boolean; error: string | null; empty?: boolean }) {
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>;
  if (loading) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  return empty ? <p className="text-sm text-muted-foreground">No records returned.</p> : null;
}

function SchoolReview({ schoolId }: { schoolId: string }) {
  const url = base + "/schools/" + encodeURIComponent(schoolId);
  const [exceptions, , exceptionError, reloadExceptions] = usePlatformLoad<{ items: Exception[] }>(url + "/payments/reconciliation", "Could not load payment exceptions.");
  const [topUps, , topUpError, reloadTopUps] = usePlatformLoad<{ items: TopUp[] }>(url + "/messaging/top-up-reconciliation", "Could not load top-up exceptions.");
  const [holds, , holdError, reloadHolds] = usePlatformLoad<MessagingReconciliationReport>(url + "/messaging/reconciliation", "Could not load reservation reconciliation.");
  return <>
    <section className={panel}><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">School payment exceptions</h2><Button size="sm" variant="outline" onClick={reloadExceptions}>Refresh</Button></div><p className="text-sm text-muted-foreground">Review is not allocation, refund or resolution. Received but unapplied funds require authorised financial handling.</p>
      <LoadState loading={!exceptions} error={exceptionError} empty={exceptions?.items.length === 0} />
      {exceptions?.items.map((row) => <article key={row.reference + ":" + row.reason} className="space-y-3 rounded-xl border p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-2"><strong>{display(row.reason)}</strong><span className="text-muted-foreground">{display(row.reviewStatus)}</span></div><p className="break-all text-xs text-muted-foreground">{row.reference} · {timestamp(row.createdAt)}</p>
        <dl className="grid gap-2 sm:grid-cols-3"><div><dt>Expected</dt><dd>{money(row.expectedKobo)}</dd></div><div><dt>Observed</dt><dd>{row.observedCurrency === "NGN" ? money(row.observedKobo) : row.observedKobo === null ? "Not established" : row.observedKobo + " minor units (" + (row.observedCurrency ?? "currency unknown") + ")"}</dd></div><div><dt>Unapplied</dt><dd>{money(row.unappliedKobo)}</dd></div></dl>
        <EvidenceAction label="Record evidence for review" path={url + "/payments/reconciliation/review"} body={{ reference: row.reference, reason: row.reason, status: "EVIDENCE_RECORDED" }} confirmation="Record this evidence reference? No money will be moved." onDone={reloadExceptions} />
        {/^PSK-[a-f0-9-]{36}-[a-f0-9-]{36}$/.test(row.reference) && <EvidenceAction label="Re-verify direct payment" path={url + "/payments/reconciliation/reverify"} body={{ reference: row.reference }} confirmation="Request a fresh Paystack verification of this existing payment? The server may apply verified funds under its allocation rules." onDone={reloadExceptions} />}
      </article>)}
      {exceptions?.items.length === 100 && <p className="text-xs text-muted-foreground">First 100 cases returned; further cases may exist.</p>}
    </section>
    <section className={panel}><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Messaging top-up exceptions</h2><Button size="sm" variant="outline" onClick={reloadTopUps}>Refresh</Button></div><LoadState loading={!topUps} error={topUpError} empty={topUps?.items.length === 0} />
      {topUps?.items.map((row) => <article key={row.reference} className="space-y-2 rounded-xl border p-3 text-sm"><p className="font-semibold">{money(row.amountKobo)} · {row.reconciliationCode ? display(row.reconciliationCode) : "Pending verification"}</p><p className="break-all text-xs text-muted-foreground">{row.reference} · Attempts: {row.recoveryAttempts}</p><EvidenceAction label="Recheck top-up" path={url + "/messaging/top-up-reconciliation/" + encodeURIComponent(row.reference) + "/recover"} confirmation="Recheck this payment with Paystack? Only verified net credit can be applied." onDone={reloadTopUps} /></article>)}
      {topUps?.items.length === 100 && <p className="text-xs text-muted-foreground">First 100 cases returned; further cases may exist.</p>}
    </section>
    <section className={panel}><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">SMS reservations</h2><Button size="sm" variant="outline" onClick={reloadHolds}>Refresh</Button></div><p className="text-sm text-muted-foreground">Escalation is an investigation deadline, never a release of uncertain funds. This view does not authorize manual debits or credits.</p><LoadState loading={!holds} error={holdError} empty={holds?.items.length === 0} />
      {holds?.items.map((row) => <article key={row.deliveryId} className="space-y-2 rounded-xl border p-3 text-sm"><p className="font-semibold">{display(row.status)}{row.escalatedAt ? " · escalated" : ""}</p><p className="break-all text-xs text-muted-foreground">{row.deliveryId}</p><dl className="grid gap-2 sm:grid-cols-3"><div><dt>Reserved</dt><dd>{money(row.reservedKobo)}</dd></div><div><dt>Charged</dt><dd>{money(row.chargedKobo)}</dd></div><div><dt>Released</dt><dd>{money(row.releasedKobo)}</dd></div></dl>{row.discrepancyRecorded && <p className="text-xs text-muted-foreground">Discrepancy recorded; provider evidence required.</p>}</article>)}
      {holds?.truncated && <p className="text-xs text-muted-foreground">Additional reservations exist.</p>}
    </section>
  </>;
}

export default function PlatformCommunicationsPage() {
  const [schools, , schoolError, reloadSchools] = usePlatformLoad<PlatformAdminSchoolDto[]>(base + "/schools", "Could not load schools.");
  const [controls, , controlError, reloadControls] = usePlatformLoad<MessagingPlatformControls>(base + "/messaging/controls", "Could not load messaging controls.");
  const [dead, , deadError, reloadDead] = usePlatformLoad<PaystackWebhookDeadLetterPage>(base + "/payments/webhooks/dead-letters", "Could not load webhook queue.");
  const [schoolId, setSchoolId] = useState("");
  return <>
    <ConsoleHeading title="Communications & reconciliation" description="Monitor messaging release controls and investigate payment or delivery exceptions. No funds are manually allocated or refunded here." />
    <section className={panel}><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Platform release status</h2><Button size="sm" variant="outline" onClick={reloadControls}>Refresh</Button></div><LoadState loading={!controls} error={controlError} />
      {controls && <><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Paid dispatch</p><strong>{controls.paidSendingEnabled ? "Enabled" : "Disabled"}</strong></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">School WhatsApp onboarding</p><strong>{controls.embeddedSignupEnabled ? "Enabled" : "Disabled"}</strong></div><div className="rounded-xl bg-muted p-3"><p className="text-xs text-muted-foreground">Daily platform ceiling</p><strong>{money(controls.dailyLimitKobo)}</strong></div></div>
        <div className="grid gap-3 sm:grid-cols-2">{(["SMS", "WHATSAPP"] as const).map((channel) => <div key={channel} className="space-y-2 rounded-xl border p-3"><h3 className="text-sm font-medium">{channel === "SMS" ? "SMS" : "WhatsApp"}</h3><p className="text-xs text-muted-foreground">Emergency state: {controls.emergency?.[channel]?.stopped === true ? "Stopped" : controls.emergency?.[channel]?.stopped === false ? "Not stopped" : "Unknown"}</p>{controls.emergency?.[channel]?.stopped === false && <EvidenceAction label="Emergency stop" path={base + "/messaging/emergency-controls"} body={{ channel, stopped: true }} confirmation={"Stop " + channel + " before its next eligible provider request? In-flight sends cannot be recalled."} onDone={reloadControls} />}</div>)}</div>
        <h3 className="text-sm font-semibold">Recorded price versions</h3>{controls.prices.length === 0 && <p className="text-sm text-muted-foreground">No verified prices returned.</p>}<div className="divide-y">{controls.prices.map((price) => <div key={price.schoolId + ":" + price.key + ":" + price.version} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><div><p>{display(price.key)} · {price.version}</p><p className="break-all text-xs text-muted-foreground">{price.schoolId}</p><p className="text-xs text-muted-foreground">{price.effective ? "Effective" : "Not effective"} · Verified {timestamp(price.verifiedAt)}</p></div><strong>{money(price.unitPriceKobo)}</strong></div>)}</div></>}
    </section>
    <section className={panel}><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Paystack webhook review</h2><Button size="sm" variant="outline" onClick={reloadDead}>Refresh</Button></div><LoadState loading={!dead} error={deadError} empty={dead?.items.length === 0} />
      {dead?.items.map((row) => <article className="space-y-2 rounded-xl border p-3 text-sm" key={row.eventKey}><div className="flex flex-wrap justify-between gap-2"><strong>{row.eventType}</strong><span>{row.attempts} attempts</span></div><p className="break-all text-xs text-muted-foreground">{row.reference ?? row.eventKey} · {timestamp(row.deadAt)}</p>{row.requiresFinancialReview ? <p className="text-sm text-muted-foreground">Financial review only — replay as a charge is prohibited.</p> : <EvidenceAction label="Queue audited replay" path={base + "/payments/webhooks/dead-letters/" + encodeURIComponent(row.eventKey) + "/replay"} confirmation="Requeue this existing authenticated event? Do not submit a new payment. Financial idempotency rules still apply." onDone={reloadDead} />}</article>)}
      {dead?.truncated && <p className="text-xs text-muted-foreground">List truncated; more records exist.</p>}
    </section>
    <section className={panel}><h2 className="font-semibold">Review one school</h2><LoadState loading={!schools} error={schoolError} /><Button variant="outline" size="sm" onClick={reloadSchools}>Refresh schools</Button><label className="block space-y-1 text-sm"><span>School</span><select className={inputStyle} value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">Select a school</option>{schools?.map((school) => <option key={school.schoolId} value={school.schoolId}>{school.name} ({school.slug})</option>)}</select></label></section>
    {schoolId && schools?.some((school) => school.schoolId === schoolId) && <SchoolReview key={schoolId} schoolId={schoolId} />}
  </>;
}
