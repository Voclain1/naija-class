"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CorrectionSession } from "@/lib/student-corrections/session";
import { FIELD_LABELS, displayCorrectionValue } from "@/lib/student-corrections/draft";
export function CorrectionReview({ session, onClose }: { session: CorrectionSession; onClose: (completed: boolean) => void }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const p = state.proposal; const [checked, setChecked] = useState(false); const [now, setNow] = useState(Date.now());
  useEffect(() => { setChecked(false); }, [state.phase, p?.id, p?.previewHash]);
  useEffect(() => { if (state.phase !== "review") return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [state.phase]);
  useEffect(() => {
    if (!p) return;
    const url = new URL(window.location.href); url.searchParams.set("review", p.id);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [p]);
  const busy = ["preparing", "confirming", "checking", "refreshing"].includes(state.phase);
  const mayClose = !busy && state.phase !== "unknown";
  const expired = p ? Date.parse(p.expiresAt) <= now : false;
  const close = () => { if (mayClose) { const completed = state.phase === "completed"; session.cancel(); const url = new URL(window.location.href); url.searchParams.delete("review"); window.history.replaceState(null, "", url.pathname + url.search); onClose(completed); } };
  return <Dialog open={state.phase !== "idle"} onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="ph-no-capture sm:max-w-5xl" data-sentry-mask onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>{state.phase === "completed" ? "Student corrections applied" : "Review student corrections"}</DialogTitle><DialogDescription>Check the student and every before/after value. The entire batch is applied together only after your confirmation.</DialogDescription></DialogHeader>
    {busy && <p role="status">{state.phase === "confirming" ? "Applying this reviewed batch…" : "Checking the saved review…"}</p>}
    {state.message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{state.message}</p>}
    {p && state.phase !== "completed" && <>
      <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-4">{[["Students to update", p.counts.toUpdate], ["Field changes", p.counts.fieldChanges], ["Values to clear", p.counts.clears], ["Rows with errors", p.counts.withErrors]].map(([label, n]) => <div key={label}><dt>{label}</dt><dd className="text-lg font-semibold">{n}</dd></div>)}</dl>
      <p className="text-xs text-muted-foreground">Dates below use day/month/year.</p>
      {p.batchErrors.map((e) => <p role="alert" key={e.code} className="text-sm text-destructive">{e.message}</p>)}
      <div className="max-h-80 space-y-3 overflow-auto">{p.rows.map((row) => <section className="rounded-lg border p-3" key={row.studentId}>
        <h3 className="font-semibold">{row.current?.name ?? "Student unavailable"}</h3><p className="text-xs text-muted-foreground">{row.current?.admissionNumber} · {row.current?.status}</p>
        {row.errors.map((e) => <p role="alert" className="text-sm text-destructive" key={e.code}>{e.message}</p>)}{row.warnings.map((w) => <p className="mt-1 text-sm" key={w.code}>{w.message}</p>)}
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Before and after corrections for {row.current?.name ?? "unavailable student"}</caption><thead><tr><th className="p-2">Field</th><th className="p-2">Before</th><th className="p-2">After</th><th className="p-2">Action</th></tr></thead><tbody>{row.fields.map((f) => <tr className="border-t" key={f.field}><td className="p-2">{FIELD_LABELS[f.field]}</td><td className="min-w-28 break-words p-2">{displayCorrectionValue(f.field, f.before)}</td><td className="min-w-28 break-words p-2">{f.change === "CLEAR" ? "Will be cleared" : displayCorrectionValue(f.field, f.after)}</td><td className="p-2">{f.change === "SAME" ? "No change" : f.change === "CLEAR" ? "Clear value" : "Replace value"}</td></tr>)}</tbody></table></div>
      </section>)}</div>
      {expired && state.phase === "review" && <p role="alert">This review expired. Refresh it before applying changes.</p>}
      {state.phase === "review" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked each student, replacement and cleared value, and approve these corrections.</label>}
    </>}
    {state.phase === "completed" && p?.outcome && <section className="space-y-3 text-sm" aria-label="Correction outcome"><p role="status">Updated {p.outcome.updatedCount} student{p.outcome.updatedCount === 1 ? "" : "s"}. Records with no changes were not rewritten.</p><ul className="space-y-2">{p.outcome.students.map((s, i) => <li key={s.studentId} className="rounded-lg bg-muted/50 p-3"><Link href={`/students/${encodeURIComponent(s.studentId)}`} className="font-medium underline">View corrected student {i + 1}</Link><p>Changed: {s.changed.map((f) => FIELD_LABELS[f]).join(", ")}</p></li>)}</ul><p>No invitation or notification was sent. Admission numbers, enrolments and other fields were not changed by this batch.</p></section>}
    {p && <p className="text-xs text-muted-foreground">This page’s review link can reopen the saved preview or outcome for your account. Unsaved editor drafts stay only in this page’s memory.</p>}
    <DialogFooter className="gap-2">
      {mayClose && <Button variant="outline" onClick={close}>{state.phase === "completed" ? "Close outcome" : "Back to editing"}</Button>}
      {state.phase === "prepare-error" && <Button onClick={() => void session.prepare()}>Retry same preview</Button>}
      {state.phase === "unknown" && <Button onClick={() => void session.check()}>Check original review</Button>}
      {(["refresh-needed", "refresh-error"].includes(state.phase) || (state.phase === "review" && expired)) && <Button onClick={() => void session.refresh()}>Refresh correction review</Button>}
      {state.phase === "review" && <Button disabled={!checked || !p?.canConfirm || expired} onClick={() => void session.confirm()}>Confirm and apply corrections</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
