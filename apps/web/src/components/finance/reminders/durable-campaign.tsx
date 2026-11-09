"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReminderSendOutcome } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/use-auth";
import { hasPermission } from "@/lib/auth/has-permission";
import { stripBasePath } from "@/lib/base-path";
import { formatKobo } from "@/lib/finance/format";
import { DurableCampaignSession } from "@/lib/reminder-campaigns/durable-session";
import type { CampaignRequest } from "@/lib/reminder-campaigns/session";

export const SEND_LABELS: Record<ReminderSendOutcome, string> = { PENDING: "Waiting", SENDING: "In progress", ACCEPTED: "Accepted by provider", SKIPPED: "Skipped", FAILED: "Refused by provider", UNKNOWN: "May have been sent", NOT_REQUESTED: "Not requested" };
const eligibility: Record<string, string> = { ELIGIBLE: "Will be reminded", NOT_FOUND: "Student unavailable", NO_BALANCE: "No outstanding balance", ON_PAYMENT_PLAN: "Excluded: payment plan", NOT_OVERDUE: "Not overdue", NO_GUARDIAN: "No linked guardian", NO_CONTACT: "No reachable contact" };
function reason(code: string | null) { return code ? code.toLowerCase().replaceAll("_", " ") : ""; }
type Props = { request?: CampaignRequest; proposalId?: string; campaignId?: string; onClose?: () => void };
export function DurableCampaignPanel(props: Props) {
  const { user, school, permissions, status } = useAuth();
  const allowed = status === "authed" && hasPermission(permissions, "finance.debtors.read") && hasPermission(permissions, "finance.debtors.remind");
  if (status === "loading") return <p role="status">Loading campaign…</p>;
  if (!allowed) return <p role="alert">Your account cannot view or send fee reminder campaigns.</p>;
  return <Mount key={`${school?.id}:${user?.id}`} {...props} />;
}
function Mount(props: Props) {
  const [session, setSession] = useState<DurableCampaignSession | null>(null);
  const { request, proposalId, campaignId } = props;
  useEffect(() => {
    const s = new DurableCampaignSession(); setSession(s);
    if (campaignId) void s.loadCampaign(campaignId);
    else if (proposalId) void s.recoverProposal(proposalId);
    else if (request) void s.start({ termId: request.termId, studentIds: [...new Set(request.studentIds)], options: { includePaymentPlans: !request.filters.excludePlans, overdueOnly: request.filters.overdueOnly } });
    return () => s.dispose();
  }, [request, proposalId, campaignId]);
  return session ? <Panel session={session} onClose={props.onClose} /> : null;
}
function Panel({ session, onClose }: { session: DurableCampaignSession; onClose?: () => void }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const p = state.proposal, c = state.campaign;
  const router = useRouter(); const pathname = usePathname();
  const [checked, setChecked] = useState(false); const [resumeChecked, setResumeChecked] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setChecked(false); }, [state.phase, p?.id, p?.previewHash]);
  useEffect(() => { setResumeChecked(false); }, [state.phase, c?.status]);
  useEffect(() => {
    // Saved identity only: no names, contacts, amounts or drafted text in URLs.
    const target = state.campaignId ? `/finance/reminders/runs/${encodeURIComponent(state.campaignId)}` : p ? `/finance/reminders/proposals/${encodeURIComponent(p.id)}` : null;
    if (target && stripBasePath(pathname) !== target) router.replace(target);
  }, [state.campaignId, p, pathname, router]);
  useEffect(() => { if (state.phase !== "review") return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [state.phase]);
  useEffect(() => {
    if (state.phase !== "live" || c?.status !== "RUNNING") return;
    const timer = setTimeout(() => void session.loadCampaign(c.id), c.heldForQuietHours ? 30000 : 3000);
    return () => clearTimeout(timer);
  }, [state.phase, c, session]);
  const expired = p ? Date.parse(p.expiresAt) <= now : false;
  const isReview = state.phase === "review";
  const working = ["preparing", "recovering", "confirming", "refreshing", "acting", "status-loading"].includes(state.phase);
  function close() { if (working || (state.phase === "unknown" && !state.campaignId)) return; if (onClose && !p && !state.campaignId) onClose(); else router.push("/finance/reminders"); }
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="ph-no-capture sm:max-w-5xl" data-sentry-mask onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>{c ? "Saved reminder campaign" : "Review saved reminder preview"}</DialogTitle><DialogDescription>{c ? "This campaign and its send results are stored securely on the server. Reopening this page reads the same campaign." : "Review the server’s selection, exclusions and delivery plan before confirming."}</DialogDescription></DialogHeader>
    {working && <p role="status">{state.phase === "confirming" ? "Confirming this campaign…" : "Checking the saved workflow…"}</p>}
    {state.message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{state.message}</p>}
    {!c && p && <>
      <p className="text-sm"><strong>Term:</strong> {p.termLabel ?? "Term unavailable"}</p>
      <dl className="grid grid-cols-3 gap-3 rounded-lg bg-muted/50 p-3 text-sm">{[["Selected students", p.counts.selected], ["Eligible students", p.counts.eligible], ["Planned sends", p.counts.plannedSends]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>)}</dl>
      <p className="text-sm">Email {p.channels.email.enabled && p.channels.email.configured ? "available" : "unavailable"} · SMS {p.channels.sms.enabled && p.channels.sms.configured ? "available" : "unavailable"} · App alerts {p.channels.push.enabled ? "enabled" : "off"}. SMS sender: {p.channels.sms.sender === "SCHOOL" ? "school-approved name" : "SchoolKit"}.</p>
      {p.batchErrors.map((e) => <p role="alert" key={e.code} className="text-sm text-destructive">{e.message}</p>)}
      {p.batchWarnings.map((w) => <p key={w.code} className="rounded-lg bg-muted/50 p-2 text-sm">{w.message}</p>)}
      <div className="max-h-64 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><caption className="sr-only">Server-reviewed reminder recipients</caption><thead className="sticky top-0 bg-card"><tr>{["Student", "Class", "Balance", "Decision", "Planned channels"].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead><tbody>{p.students.map((s) => <tr key={s.studentId} className="border-t"><td className="min-w-36 p-2">{s.name ?? "Student unavailable"}<p className="text-xs">{s.admissionNumber}</p></td><td className="p-2">{s.classLabel ?? "—"}</td><td className="whitespace-nowrap p-2">{formatKobo(s.balance)}</td><td className="min-w-32 p-2">{eligibility[s.eligibility]}</td><td className="min-w-36 p-2">{s.planned.emailGuardians} guardian email(s) · {s.planned.mobile === "NONE" ? "no mobile send" : reason(s.planned.mobile)}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">{p.limits}</p>
      {expired && isReview && <p role="alert" className="text-sm">This preview expired. Refresh and review again.</p>}
      {isReview && <label className="flex gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked the term, exclusions and planned sends, and approve this campaign.</label>}
    </>}
    {c && <section className="space-y-3 text-sm" aria-label="Saved campaign results">
      <p role="status" className="font-semibold">Campaign: {c.status === "RUNNING" ? "In progress" : c.status === "HALTED" ? "Halted" : "Completed"}</p>
      {c.heldForQuietHours && <p className="rounded-lg bg-muted/50 p-3">Sends are held for quiet hours, 21:00–06:00 Lagos time.</p>}
      {c.haltReason && <p role="alert">Stopped: {reason(c.haltReason)}. Resume requires a fresh permission and feature check.</p>}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(c.counts).map(([outcome, count]) => <div className="rounded-lg bg-muted/50 p-2" key={outcome}><dt>{SEND_LABELS[outcome as ReminderSendOutcome]}</dt><dd className="text-lg font-semibold">{count}</dd></div>)}</dl>
      {c.counts.UNKNOWN > 0 && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-950">Some sends may have gone out. Unknown sends are never retried automatically; check before contacting those families again.</p>}
      <div className="max-h-72 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><caption className="sr-only">Per-student send outcomes</caption><thead className="sticky top-0 bg-card"><tr><th className="p-2">Student</th><th className="p-2">Channel and outcome</th></tr></thead><tbody>{c.students.map((s) => <tr className="border-t" key={s.studentId}><td className="min-w-40 p-2">{s.name ?? "Student unavailable"}<p className="text-xs">{s.admissionNumber}</p></td><td className="min-w-48 p-2">{s.sends.map((send) => <p key={`${send.guardianId}:${send.slot}`}>Guardian {[...new Set(s.sends.map((item) => item.guardianId))].indexOf(send.guardianId) + 1} · {send.channelUsed ?? (send.slot === "EMAIL" ? "Email" : "Mobile")} · <strong>{SEND_LABELS[send.outcome]}</strong>{send.reason ? ` · ${reason(send.reason)}` : ""}</p>)}</td></tr>)}</tbody></table></div>
      <p className="text-xs text-muted-foreground">{c.limits}</p>
      {c.status === "HALTED" && <label className="flex gap-2"><input type="checkbox" checked={resumeChecked} onChange={(e) => setResumeChecked(e.target.checked)} />Resume only sends that were never attempted. Unknown sends will stay unknown.</label>}
    </section>}
    <DialogFooter className="flex-wrap gap-2">
      {!working && state.phase !== "unknown" && <Button variant="outline" onClick={close}>Back to reminder selection</Button>}
      {state.phase === "prepare-error" && <Button onClick={() => void session.prepare()}>Retry same preview</Button>}
      {["unknown", "status-error"].includes(state.phase) && <Button onClick={() => void session.check()}>Check saved status</Button>}
      {(["refresh-needed", "refresh-error"].includes(state.phase) || (isReview && expired)) && <Button onClick={() => void session.refresh()}>Refresh saved preview</Button>}
      {isReview && <Button disabled={!checked || !p?.canConfirm || expired} onClick={() => void session.confirm()}>Confirm campaign</Button>}
      {c && state.phase === "live" && <Button variant="outline" onClick={() => void session.loadCampaign(c.id)}>Refresh campaign status</Button>}
      {c?.status === "RUNNING" && state.phase === "live" && <Button variant="outline" onClick={() => void session.act("halt")}>Halt remaining sends</Button>}
      {c?.status === "HALTED" && state.phase === "live" && <Button disabled={!resumeChecked} onClick={() => void session.act("resume")}>Resume unattempted sends</Button>}
    </DialogFooter>
    {c && <Link href={`/finance/reminders/runs/${encodeURIComponent(c.id)}`} className="text-xs underline">Permanent link to this campaign (your account only)</Link>}
  </DialogContent></Dialog>;
}
