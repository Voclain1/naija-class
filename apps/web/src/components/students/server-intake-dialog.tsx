"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { IntakeSession } from "@/lib/students/intake-session";

export function ServerIntakeDialog({ session }: { session: IntakeSession }) {
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const { phase, proposal: p } = state;
  const [checked, setChecked] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setChecked(false); }, [phase, p?.id, p?.previewHash]);
  useEffect(() => { if (phase === "idle") return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [phase]);
  const waiting = ["preparing", "confirming", "checking", "refreshing"].includes(phase);
  const canLeave = ["review", "prepare-error", "refresh-needed", "refresh-error"].includes(phase);
  const expired = p ? Date.parse(p.expiresAt) <= now : false;
  const mayConfirm = phase === "review" && p?.canConfirm && !expired;
  return <Dialog open={phase !== "idle"} onOpenChange={(open) => { if (!open && canLeave) session.cancel(); }}>
    <DialogContent className="ph-no-capture sm:max-w-4xl" data-sentry-mask onEscapeKeyDown={(e) => { if (!canLeave) e.preventDefault(); }} onPointerDownOutside={(e) => e.preventDefault()}>
      <DialogHeader><DialogTitle>{phase === "unknown" ? "Check this intake’s save outcome" : "Review students before saving"}</DialogTitle><DialogDescription>SchoolKit checks this batch on the server. No students are added until you confirm. Parent links and invitations stay separate.</DialogDescription></DialogHeader>
      {waiting && <p role="status">{phase === "preparing" ? "Checking the students and placement…" : phase === "confirming" ? "Saving this reviewed intake…" : phase === "refreshing" ? "Refreshing the preview…" : "Checking whether this intake was saved…"}</p>}
      {state.message && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">{state.message}</p>}
      {p && <>
        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-4">{[["Students", p.counts.rows], ["Rows with errors", p.counts.withErrors], ["Rows with warnings", p.counts.withWarnings], ["Numbers assigned on confirm", p.counts.assignedOnConfirm]].map(([label, n]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{n}</dd></div>)}</dl>
        <div className="rounded-lg bg-primary/5 p-3 text-sm">{p.placement.mode === "ENROL" ? <><p><strong>Class:</strong> {p.placement.classLabel ?? "Class unavailable"}</p><p><strong>Term:</strong> {p.placement.termLabel ?? "Term unavailable"}</p></> : <p><strong>No class placement.</strong> These students will be added to the roster only. They will need enrolment before appearing in class registers, invoices or results.</p>}</div>
        {(p.batchErrors.length > 0 || p.batchWarnings.length > 0) && <ul className="space-y-1 text-sm">{p.batchErrors.map((e) => <li key={e.code} className="text-destructive"><strong>Cannot save:</strong> {e.message}</li>)}{p.batchWarnings.map((w) => <li key={w.code}><strong>Check:</strong> {w.message}</li>)}</ul>}
        {!!p.rows.length && <div className="max-h-64 overflow-auto rounded-lg border"><table className="w-full text-left text-sm"><caption className="sr-only">Server-reviewed student rows</caption><thead className="sticky top-0 bg-card"><tr>{["Row", "Student", "Admission number", "Date of birth", "Gender", "Email", "Checks"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>)}</tr></thead><tbody>{p.rows.map((r) => <tr key={r.index} className="border-t"><td className="p-2">{r.index + 1}</td><td className="min-w-36 p-2">{[r.values.firstName, r.values.middleName, r.values.lastName].filter(Boolean).join(" ")}</td><td className="p-2">{r.admissionNumberSource === "ASSIGNED_ON_CONFIRM" ? "Assigned when you confirm" : r.admissionNumber}</td><td className="whitespace-nowrap p-2">{r.values.dateOfBirth.slice(0, 10).split("-").reverse().join("/")}</td><td className="p-2">{r.values.gender}</td><td className="p-2">{r.values.email || "—"}</td><td className="min-w-48 p-2">{r.errors.map((e) => <p key={e.code} className="text-destructive">{e.message}</p>)}{r.warnings.map((w) => <p key={w.code}>{w.message}</p>)}</td></tr>)}</tbody></table></div>}
        <p className="text-xs text-muted-foreground">{p.duplicateRule} Automatic admission numbers are not reserved by this preview.</p>
        {expired && phase === "review" && <p role="alert" className="text-sm">This preview expired. Refresh and review it again.</p>}
        {mayConfirm && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked these students and their placement.</label>}
      </>}
      <DialogFooter className="gap-2">
        {canLeave && <Button type="button" variant="outline" onClick={() => session.cancel()}>Back to editing</Button>}
        {phase === "prepare-error" && <Button type="button" onClick={() => void session.prepare()}>Retry preview</Button>}
        {phase === "unknown" && <Button type="button" onClick={() => void session.check()}>Check save outcome</Button>}
        {(["refresh-needed", "refresh-error"].includes(phase) || (phase === "review" && expired)) && <Button type="button" onClick={() => void session.refresh()}>Refresh preview</Button>}
        {phase === "review" && !expired && <Button type="button" disabled={!mayConfirm || !checked} onClick={() => void session.confirm()}>Confirm and save {p?.counts.rows} student{p?.counts.rows === 1 ? "" : "s"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
