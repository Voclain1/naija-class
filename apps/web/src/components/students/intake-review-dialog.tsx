"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { intakeReviewSummary, type IntakeReview } from "@/lib/students/intake-review";

export function IntakeReviewDialog({ review, onDecision }: {
  review: IntakeReview | null;
  onDecision: (approved: boolean) => void;
}) {
  const [checked, setChecked] = useState(false);
  useEffect(() => setChecked(false), [review]);
  const summary = review ? intakeReviewSummary(review) : null;
  return <Dialog open={review !== null} onOpenChange={(open) => { if (!open) onDecision(false); }}>
    <DialogContent className="ph-no-capture sm:max-w-3xl" data-sentry-mask>
      <DialogHeader><DialogTitle>Review students before saving</DialogTitle>
        <DialogDescription>Nothing has been saved from this review. Check the names, dates and placement, then confirm.</DialogDescription>
      </DialogHeader>
      {review && summary && <>
        <dl className="grid gap-3 rounded-lg bg-muted/50 p-4 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">New students</dt><dd className="text-lg font-semibold">{summary.createCount}</dd></div>
          <div><dt className="text-muted-foreground">Enrolled on save</dt><dd className="text-lg font-semibold">{summary.enrollmentCount}</dd></div>
          <div><dt className="text-muted-foreground">Already saved, excluded</dt><dd className="text-lg font-semibold">{summary.alreadySaved}</dd></div>
        </dl>
        <div className="rounded-lg bg-primary/5 p-3 text-sm">
          {review.placement ? <><p><strong>Class:</strong> {review.placement.classLabel}</p><p><strong>Term:</strong> {review.placement.termLabel}</p></> : <p><strong>No class placement.</strong> These students will be saved to the roster only. They will need an enrollment before appearing in registers, invoices or results.</p>}
        </div>
        {summary.requestCount > 1 && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">This list needs {summary.requestCount} separate save requests. Each request saves all its rows or none. If a later request fails, earlier successful requests stay saved.</p>}
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-left text-sm"><caption className="sr-only">Students in this save request</caption>
            <thead className="sticky top-0 bg-card"><tr>{["Row", "Student", "Admission number", "Date of birth (DD/MM/YYYY)", "Gender", "Email"].map((h) => <th key={h} className="whitespace-nowrap p-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>{review.rows.map((r) => <tr key={r.rowNumber} className="border-t"><td className="p-2">{r.rowNumber}</td><td className="min-w-36 p-2">{r.name}</td><td className="p-2">{r.admissionNumber || "Assigned on save"}</td><td className="whitespace-nowrap p-2">{r.dateOfBirth.split("-").reverse().join("/")}</td><td className="p-2">{r.gender}</td><td className="p-2">{r.email || "—"}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Existing admission numbers are checked again by the server when saving. Students are never merged by name. Guardians and invitations are handled separately.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked these students and their placement.</label>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onDecision(false)}>Back to editing</Button><Button type="button" disabled={!checked} onClick={() => onDecision(true)}>Confirm and save {summary.createCount} student{summary.createCount === 1 ? "" : "s"}</Button></DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
