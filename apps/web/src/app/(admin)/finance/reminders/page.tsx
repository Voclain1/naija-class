"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Send, UsersRound } from "lucide-react";
import { FEE_RISK_LEVELS, FEE_RISK_LEVEL_LABELS, type AcademicYearDto, type TermDto, type DebtorDto } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { CampaignReview } from "@/components/finance/reminders/campaign-review";
import { InlineAlert } from "@/components/shared/inline-alert";
import { useAuth } from "@/lib/auth/use-auth";
import { hasPermission } from "@/lib/auth/has-permission";
import { listAcademicYears, listTerms } from "@/lib/academic-years/academic-years-api";
import { listDebtors } from "@/lib/finance/finance-api";
import { financeErrorMessage } from "@/lib/finance/error-copy";
import { formatKobo } from "@/lib/finance/format";
import { DEFAULT_REMINDER_FILTERS, MAX_REMINDER_CAMPAIGN_STUDENTS, reminderAudience, type ReminderFilters } from "@/lib/reminder-campaigns/audience";
import type { CampaignRequest } from "@/lib/reminder-campaigns/session";

const selectClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50";
export default function ReminderCampaignPage() {
  const { status, school, user, permissions } = useAuth();
  if (status === "loading") return <p role="status">Loading reminder workspace…</p>;
  if (status !== "authed" || !hasPermission(permissions, "finance.debtors.read") || !hasPermission(permissions, "finance.debtors.remind")) return <div className="rounded-xl bg-muted p-6"><h1 className="text-xl font-semibold">Fee reminders are not available for this account</h1><p className="mt-2 text-sm">Ask your school administrator for access to view debtors and send reminders.</p></div>;
  return <Workspace key={`${school?.id}:${user?.id}`} canReadChannels={hasPermission(permissions, "notification-preferences.read")} canReadGuardians={hasPermission(permissions, "guardian.read")} />;
}
function Workspace({ canReadChannels, canReadGuardians }: { canReadChannels: boolean; canReadGuardians: boolean }) {
  const [years, setYears] = useState<AcademicYearDto[]>([]);
  const [yearId, setYearId] = useState("");
  const [terms, setTerms] = useState<TermDto[]>([]);
  const [termId, setTermId] = useState("");
  const [rows, setRows] = useState<DebtorDto[]>([]);
  const [filters, setFilters] = useState<ReminderFilters>({ ...DEFAULT_REMINDER_FILTERS });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [request, setRequest] = useState<CampaignRequest | null>(null);
  useEffect(() => {
    let cancelled = false;
    listAcademicYears().then((y) => { if (!cancelled) { setYears(y); setYearId(y.find((v) => v.isCurrent)?.id ?? ""); } }).catch((e) => { if (!cancelled) setReferenceError(financeErrorMessage(e)); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false; setTerms([]); setTermId(""); setSelected(new Set()); setRows([]);
    if (yearId) void listTerms(yearId).then((t) => { if (!cancelled) { setTerms(t); setTermId(t.find((v) => v.isCurrent)?.id ?? ""); } }).catch((e) => { if (!cancelled) setReferenceError(financeErrorMessage(e)); });
    return () => { cancelled = true; };
  }, [yearId]);
  useEffect(() => {
    let cancelled = false; setRows([]); setSelected(new Set()); setError(null); setLoading(!!termId);
    if (termId) void listDebtors(termId).then((d) => { if (!cancelled) setRows(d); }).catch((e) => { if (!cancelled) setError(financeErrorMessage(e)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [termId, attempt]);
  const shown = useMemo(() => reminderAudience(rows, filters), [rows, filters]);
  const selectedVisible = shown.filter((s) => selected.has(s.studentId));
  function filter(patch: Partial<ReminderFilters>) { setFilters((f) => ({ ...f, ...patch })); setSelected(new Set()); }
  function toggle(id: string) { setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function review() {
    if (!termId || !selectedVisible.length || selectedVisible.length > MAX_REMINDER_CAMPAIGN_STUDENTS) return;
    const term = terms.find((t) => t.id === termId); const year = years.find((y) => y.id === yearId);
    if (!term || !year) return;
    setRequest({ termId, termLabel: `${year.label} — ${term.name}`, studentIds: selectedVisible.map((s) => s.studentId), filters: { ...filters }, canReadChannels, canReadGuardians });
  }
  return <div className="ph-no-capture mx-auto max-w-6xl space-y-6" data-sentry-mask>
    <header className="space-y-2"><Link href="/finance/debtors" className="text-sm underline">Back to debtors</Link><div className="flex items-center gap-2 text-primary"><Send className="h-5 w-5" /><span className="text-sm font-medium">Fee reminder run</span></div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Follow up with the right families.</h1><p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">Choose students, review current invoices and delivery information, then approve one run. Payment plans are excluded by default. Reminders use email, SMS or app alerts according to your school’s settings.</p></header>
    <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label="Reminder run steps">{["Choose a term and audience", "Review students and channels", "Confirm and check results"].map((label, i) => <li key={label} className="rounded-lg bg-muted/50 p-3"><strong>{i + 1}.</strong> {label}</li>)}</ol>
    {referenceError && <InlineAlert title="Could not load the academic calendar" action={{ label: "Reload calendar", onClick: () => window.location.reload() }}>{referenceError}</InlineAlert>}
    <section aria-label="Reminder audience" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm"><span>Academic year</span><select aria-label="Academic year" className={selectClass} value={yearId} onChange={(e) => { setReferenceError(null); setYearId(e.target.value); }}><option value="">Choose a year…</option>{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>Term</span><select aria-label="Term" className={selectClass} value={termId} disabled={!yearId || !terms.length} onChange={(e) => setTermId(e.target.value)}><option value="">Choose a term…</option>{terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>Class</span><select aria-label="Class" className={selectClass} value={filters.classArm} onChange={(e) => filter({ classArm: e.target.value })}><option value="">All classes</option>{[...new Set(rows.map((r) => r.classArm))].sort().map((arm) => <option key={arm} value={arm}>{arm}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span>Risk</span><select aria-label="Risk" className={selectClass} value={filters.risk} onChange={(e) => filter({ risk: e.target.value as ReminderFilters["risk"] })}><option value="">All risk levels</option>{FEE_RISK_LEVELS.map((r) => <option key={r} value={r}>{FEE_RISK_LEVEL_LABELS[r]}</option>)}</select></label>
      </div>
      <label className="block space-y-1 text-sm"><span>Find a student</span><input aria-label="Find a student" className={selectClass} value={filters.search} placeholder="Name or admission number" onChange={(e) => filter({ search: e.target.value })} /></label>
      <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={filters.overdueOnly} onChange={(e) => filter({ overdueOnly: e.target.checked })} />Overdue invoices only</label><label className="flex items-center gap-2"><input type="checkbox" checked={filters.excludePlans} onChange={(e) => filter({ excludePlans: e.target.checked })} />Exclude students with payment plans</label></div>
      <p className="text-xs text-muted-foreground">Changing a filter clears the selection. A student appears once even with supplementary invoices; all their outstanding invoice balances are shown. Risk is for staff only and is not sent to families.</p>
    </section>
    {error && <InlineAlert title="Could not load outstanding invoices" action={{ label: "Retry", onClick: () => setAttempt((n) => n + 1) }}>{error}</InlineAlert>}
    {loading && <p role="status">Loading outstanding invoices…</p>}
    {!termId && !referenceError && <p role="status">Choose an academic year and term to start.</p>}
    {termId && !loading && !error && <section aria-label="Students matching this run" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="inline-flex items-center gap-2 text-sm"><UsersRound className="h-4 w-4" />{shown.length} matching students · {selectedVisible.length} selected</p><div className="flex flex-wrap gap-2"><Button variant="outline" type="button" disabled={!shown.length} onClick={() => setSelected(new Set(shown.slice(0, MAX_REMINDER_CAMPAIGN_STUDENTS).map((s) => s.studentId)))}>Select {shown.length > MAX_REMINDER_CAMPAIGN_STUDENTS ? "first 500" : "matching students"}</Button><Button variant="outline" type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear selection</Button><Button type="button" disabled={!selectedVisible.length || selectedVisible.length > MAX_REMINDER_CAMPAIGN_STUDENTS} onClick={review}>Review reminder run</Button></div></div>
      {selectedVisible.length > MAX_REMINDER_CAMPAIGN_STUDENTS && <p role="alert">Choose up to 500 students in one run.</p>}
      {!shown.length ? <p className="rounded-xl bg-muted/50 p-5 text-sm">No students match these filters. Try including invoices that are not overdue, or students with payment plans.</p> : <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><caption className="sr-only">Select students for a reminder run</caption><thead className="bg-muted/40"><tr>{["Select", "Student", "Class", "Outstanding invoices"].map((label) => <th className="p-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{shown.map((s) => <tr className="border-t" key={s.studentId}><td className="p-3"><input type="checkbox" aria-label={`Select ${s.name}`} checked={selected.has(s.studentId)} onChange={() => toggle(s.studentId)} /></td><td className="min-w-36 p-3"><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.admissionNumber}</p></td><td className="p-3">{s.classArm}</td><td className="min-w-40 p-3">{s.invoices.map((i) => <p key={i.invoiceId}>{i.supplementary ? "Supplementary" : "Term"}: {formatKobo(i.balance)} {i.hasPaymentPlan ? "· payment plan" : ""}</p>)}</td></tr>)}</tbody></table></div>}
    </section>}
    <aside className="rounded-xl bg-muted/50 p-4 text-sm text-muted-foreground">This page keeps the selection and results only while it is open. It does not schedule reminders, keep campaign history or automatically retry a send. If a send response is lost, stop and check before sending again.</aside>
    {request && <CampaignReview request={request} onClose={() => { setRequest(null); setSelected(new Set()); setAttempt((n) => n + 1); }} />}
  </div>;
}
