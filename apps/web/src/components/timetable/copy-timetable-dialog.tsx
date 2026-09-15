"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { CopyResultDto, TimetableHeaderDto, TimetableOptionsDto } from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { CopyProblemsList, hasProblems, problemsOf } from "@/components/timetable/copy-problems";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { copyTimetable } from "@/lib/timetable/timetable-api";

// Phase 8 / CP4 — copy a class's timetable to another term or year (§18 D42).
//
// Always PREVIEW first: the server runs the real copy and rolls it back,
// returning every problem. "Copy" is enabled only when the preview is clean — or
// when the only problem is unassigned teachers AND the admin chose to leave
// exactly those teachers off (Q42), in which case the confirmed list is sent and
// the server refuses if it no longer matches.

const SELECT = "h-10 rounded-md border border-input bg-background px-3 text-sm";

export function CopyTimetableDialog({
  open,
  source,
  className,
  options,
  onClose,
  onCopied,
}: {
  open: boolean;
  source: TimetableHeaderDto | null;
  className: string;
  options: TimetableOptionsDto;
  onClose: () => void;
  onCopied: (dest: { academicYearId: string; termId: string | null }) => void;
}) {
  const [yearId, setYearId] = useState("");
  const [termId, setTermId] = useState<string>("");
  const [preview, setPreview] = useState<CopyResultDto | null>(null);
  const [leaveOff, setLeaveOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !source) return;
    const next = options.academicYears.find((y) => y.id !== source.academicYearId) ?? options.academicYears[0];
    setYearId(next?.id ?? "");
    setTermId("");
    setPreview(null);
    setLeaveOff(false);
    setError(null);
  }, [open, source, options]);

  const year = options.academicYears.find((y) => y.id === yearId);
  const input = () => ({
    academicYearId: yearId,
    termId: termId === "" ? null : termId,
    leaveUnassignedTeachersOff: leaveOff,
    acknowledgedRemovals: leaveOff
      ? (preview?.problems.unassignedTeachers ?? []).map(({ dayOfWeek, bellSlotId, teacherId }) => ({ dayOfWeek, bellSlotId, teacherId }))
      : [],
  });

  async function runPreview() {
    if (!source) return;
    setBusy(true);
    setError(null);
    setLeaveOff(false);
    try {
      setPreview(await copyTimetable(source.id, { ...input(), leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] }, true));
    } catch (e) {
      setPreview(null);
      setError(e instanceof ApiError ? e.message : "Could not check the copy.");
    } finally {
      setBusy(false);
    }
  }

  async function runCopy() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const r = await copyTimetable(source.id, input(), false);
      toast.success(
        `Copied ${r.lessonsCopied} lesson${r.lessonsCopied === 1 ? "" : "s"}${r.removedTeachers.length ? `, leaving off ${r.removedTeachers.length} teacher assignment${r.removedTeachers.length === 1 ? "" : "s"}` : ""}. Not published yet.`,
      );
      onCopied({ academicYearId: yearId, termId: termId === "" ? null : termId });
    } catch (e) {
      const p = problemsOf(e);
      if (p && preview) setPreview({ ...preview, ok: false, problems: p });
      setError(e instanceof ApiError ? e.message : "Could not copy the timetable.");
    } finally {
      setBusy(false);
    }
  }

  const p = preview?.problems;
  const onlyUnassigned = !!p && p.unassignedTeachers.length > 0 && p.destinationLessonCount === 0 && p.clashes.length === 0 && !p.acknowledgementMismatch;
  const canCopy = !!preview && (preview.ok || (onlyUnassigned && leaveOff));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {className}&apos;s timetable</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            Copies every lesson and teacher into {className}&apos;s timetable for another term or year. Nothing is overwritten, and the copy is
            not published until you publish it.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Academic year</span>
              <select aria-label="Copy to year" className={SELECT} value={yearId} onChange={(e) => { setYearId(e.target.value); setTermId(""); setPreview(null); }}>
                {options.academicYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Timetable</span>
              <select aria-label="Copy to term" className={SELECT} value={termId} onChange={(e) => { setTermId(e.target.value); setPreview(null); }}>
                <option value="">Whole year</option>
                {year?.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} only
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <InlineAlert>{error}</InlineAlert>}

          {preview && p && (hasProblems(p) ? (
            <InlineAlert title="This copy can't be made yet" tone="warning">
              <CopyProblemsList problems={p} />
              {onlyUnassigned && (
                <label className="mt-3 flex items-start gap-2">
                  <input type="checkbox" checked={leaveOff} onChange={(e) => setLeaveOff(e.target.checked)} />
                  <span>Copy anyway, leaving exactly these teachers off those lessons (the subjects stay).</span>
                </label>
              )}
            </InlineAlert>
          ) : (
            <div role="status" className="rounded-md border border-primary/30 bg-primary/5 p-3">
              Ready: {preview.lessonsCopied} lesson{preview.lessonsCopied === 1 ? "" : "s"} will be copied.
              {preview.assignmentWarnings.length > 0 && (
                <span> Some teachers are assigned for only part of the destination: {preview.assignmentWarnings.map((w) => w.teacherName).join(", ")}.</span>
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="outline" onClick={() => void runPreview()} disabled={busy || !yearId}>
            {busy && !preview && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Check copy
          </Button>
          <Button type="button" onClick={() => void runCopy()} disabled={busy || !canCopy}>
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
