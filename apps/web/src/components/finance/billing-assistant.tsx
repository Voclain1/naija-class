"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BillingContextDto, BillingRunDto } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";
import { formatKobo } from "@/lib/finance/format";

const ROOT = "/assistant/billing";
const control = "w-full rounded-md border border-input bg-background p-2 text-sm";
const errorText = (e: unknown) => e instanceof ApiError ? e.message : "This request could not finish. Check the run before retrying.";

export function BillingAssistant({ onIssued }: { onIssued: () => void }) {
  const { user, school, status, permissions } = useAuth();
  const account = `${status}:${school?.id ?? ""}:${user?.id ?? ""}`;
  const accountRef = useRef(account); accountRef.current = account;
  const generation = useRef(0);
  const [shownAccount, setShownAccount] = useState("");
  const lastActivity = useRef(Date.now());
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<BillingContextDto | null>(null);
  const [termId, setTerm] = useState("");
  const [arms, setArms] = useState<string[]>([]);
  const [request, setRequest] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [run, setRun] = useState<BillingRunDto | null>(null);
  const [history, setHistory] = useState<BillingRunDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const pending = useRef(false);
  const mayRead = permissions.includes("*") || permissions.includes("invoice.read");
  const mayIssue = permissions.includes("*") || permissions.includes("invoice.issue");

  const clear = useCallback(() => {
    generation.current += 1;
    setRequest(""); setArms([]); setRun(null); setConfirmed(false); setError(null);
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    clear(); setEnabled(false); setOpen(false); setContext(null); setHistory([]); setTerm(""); setDueDate("");
    if (status !== "authed" || !mayRead) return;
    let live = true;
    apiFetch<{ enabled: boolean }>(`${ROOT}/availability`).then((r) => { if (live) { setEnabled(r.enabled); setShownAccount(account); } }).catch(() => {});
    return () => { live = false; };
  }, [account, status, mayRead, clear]);

  useEffect(() => {
    const check = () => { if (Date.now() - lastActivity.current >= 15 * 60_000) { clear(); setOpen(false); } };
    const timer = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [clear]);

  const act = async (work: () => Promise<void>) => {
    if (pending.current || status !== "authed") return;
    pending.current = true; setBusy(true); setError(null);
    try { await work(); } catch (e) { setError(errorText(e)); setConfirmed(false); }
    finally { pending.current = false; setBusy(false); lastActivity.current = Date.now(); }
  };

  const start = () => act(async () => {
    const owner = `${accountRef.current}:${generation.current}`;
    const [next, recent] = await Promise.all([
      apiFetch<BillingContextDto>(`${ROOT}/context`), apiFetch<BillingRunDto[]>(`${ROOT}/runs`),
    ]);
    if (owner !== `${accountRef.current}:${generation.current}`) return;
    setContext(next); setHistory(recent); setOpen(true);
  });

  const prepare = (fromRequest: boolean) => act(async () => {
    const owner = `${accountRef.current}:${generation.current}`;
    setRun(null); setConfirmed(false);
    const next = await apiFetch<BillingRunDto>(`${ROOT}/${fromRequest ? "request" : "runs"}`, {
      method: "POST", body: { termId, dueDate: dueDate || undefined,
        ...(fromRequest ? { request } : { classArmIds: arms }) },
    });
    if (owner !== `${accountRef.current}:${generation.current}`) return;
    setRequest(""); setRun(next); setHistory((h) => [next, ...h].slice(0, 20));
  });

  const approve = () => act(async () => {
    if (!run || !confirmed || !mayIssue) return;
    const owner = `${accountRef.current}:${generation.current}`;
    const next = await apiFetch<BillingRunDto>(`${ROOT}/runs/${run.id}/approve`, {
      method: "POST", body: { previewHash: run.previewHash },
    });
    if (owner !== `${accountRef.current}:${generation.current}`) return;
    setRun(next); setHistory((h) => h.map((r) => r.id === next.id ? next : r)); setConfirmed(false); onIssued();
  });

  if (shownAccount !== account || !enabled || !mayRead || status !== "authed") return null;
  return <section className="ph-no-capture rounded-xl border border-border bg-card p-4 sm:p-6" aria-label="Invoice assistant" data-sentry-mask>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Prepare invoices with SchoolKit</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose a term, tell us which classes to bill, then review and approve the run.</p></div>
      <Button variant="outline" disabled={busy} onClick={() => open ? setOpen(false) : void start()}>{open ? "Close" : "Prepare a billing run"}</Button>
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    {open && context && <div className="mt-5 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Term<select aria-label="Billing term" className={control} value={termId} disabled={busy} onChange={(e) => { setTerm(e.target.value); setRun(null); setConfirmed(false); }}>
          <option value="">Choose the term to bill</option>{context.terms.map((t) => <option key={t.id} value={t.id}>{t.year} · {t.name}</option>)}
        </select></label>
        <label className="space-y-1 text-sm">Due date (optional)<input aria-label="Billing due date" type="date" className={control} value={dueDate} disabled={busy} onChange={(e) => { setDueDate(e.target.value); setRun(null); setConfirmed(false); }} /></label>
      </div>
      <div className="space-y-2"><label htmlFor="billing-request" className="text-sm font-medium">What would you like to prepare?</label>
        <p className="text-sm text-muted-foreground">For example: “Prepare invoices for all classes” or “Generate invoices for JSS 2”. Use class names, not personal details. Nothing is issued until you approve.</p>
        <textarea id="billing-request" data-ph-mask data-sentry-mask className={control} rows={2} maxLength={500} value={request} disabled={busy} onChange={(e) => { setRequest(e.target.value); lastActivity.current = Date.now(); }} />
        <Button disabled={busy || !termId || !request.trim()} onClick={() => void prepare(true)}>Prepare from request</Button>
      </div>
      <details><summary className="cursor-pointer text-sm font-medium">Choose classes directly</summary>
        <fieldset disabled={busy} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><legend className="sr-only">Classes to bill</legend>
          {context.arms.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={arms.includes(a.id)} onChange={(e) => setArms((old) => e.target.checked ? [...old, a.id] : old.filter((id) => id !== a.id))} />{a.level} · {a.name}</label>)}
        </fieldset>
        <Button className="mt-3" variant="outline" disabled={busy || !termId || !arms.length} onClick={() => void prepare(false)}>Preview selected classes</Button>
      </details>
      {run && <div className="space-y-4 rounded-lg bg-muted/40 p-4" aria-live="polite">
        <h3 className="font-semibold">{run.status === "COMPLETED" ? "Billing complete" : "Review before issuing"} · {run.termLabel}</h3>
        <p className="text-sm">{run.result?.created ?? run.createCount} invoices · {formatKobo(BigInt(run.result?.totalDueKobo ?? run.totalDueKobo))} · {run.result?.skipped ?? run.skipCount} already invoiced and skipped</p>
        <p className="text-sm">Due: {run.dueDate ?? "No due date"}. Preview expires: {new Date(run.expiresAt).toLocaleString()}.</p>
        {run.blockers.map((b) => <p key={b} role="alert" className="rounded-md bg-amber-50 p-2 text-sm text-amber-950">{b}</p>)}
        {run.arms.map((a) => <details key={a.classArmId}><summary className="cursor-pointer text-sm font-medium">{a.label}: {a.createCount} new · {a.skipCount} skipped · {formatKobo(BigInt(a.totalDueKobo))}</summary>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Student</th><th className="p-2">Total due</th><th className="p-2">Action</th></tr></thead><tbody>{a.rows.map((r) => <tr key={r.studentId}><td className="p-2">{r.studentName ?? "Student record"}{r.admissionNumber ? ` · ${r.admissionNumber}` : ""}</td><td className="p-2">{formatKobo(r.totalDue)}</td><td className="p-2">{r.alreadyInvoiced ? "Skip existing invoice" : "Issue invoice"}</td></tr>)}</tbody></table></div>
        </details>)}
        {run.status === "PENDING" && <>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !!run.blockers.length || !mayIssue} onChange={(e) => setConfirmed(e.target.checked)} />I have checked the term, classes, due date and amounts. Issue these invoices.</label>
          <Button disabled={busy || !confirmed || !!run.blockers.length || !mayIssue || Date.parse(run.expiresAt) <= Date.now()} onClick={() => void approve()}>{busy ? "Working…" : "Approve and issue invoices"}</Button>
          {!mayIssue && <p className="text-sm text-muted-foreground">An authorised bursar or administrator must approve this run.</p>}
        </>}
        {run.result && <Link className="text-sm font-medium text-primary underline" href={`/finance/invoices?tab=list&termId=${run.termId}`}>Open issued invoices</Link>}
      </div>}
      {!!history.length && <details><summary className="cursor-pointer text-sm font-medium">Recent billing runs</summary><ul className="mt-2 space-y-2">{history.map((h) => <li key={h.id}><button type="button" className="text-left text-sm text-primary underline" disabled={busy} onClick={() => void act(async () => {
        const owner = `${accountRef.current}:${generation.current}`; const next = await apiFetch<BillingRunDto>(`${ROOT}/runs/${h.id}`); if (owner === `${accountRef.current}:${generation.current}`) { setRun(next); setConfirmed(false); }
      })}>{h.termLabel} · {new Date(h.createdAt).toLocaleString()} · {h.status === "COMPLETED" ? "Completed" : Date.parse(h.expiresAt) <= Date.now() ? "Expired" : "Awaiting approval"}</button></li>)}</ul></details>}
      <Button variant="ghost" disabled={busy} onClick={clear}>Clear request and preview</Button>
    </div>}
  </section>;
}
