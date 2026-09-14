"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  ISO_WEEKDAY_LABELS,
  type AssignmentWarningDto,
  type LessonDto,
  type SubjectDto,
  type TimetableClashDto,
  type TimetableViewDto,
} from "@school-kit/types";

import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError } from "@/lib/api-client";
import { clashesOf, clearLesson, saveLesson } from "@/lib/timetable/timetable-api";
import { maxSpanFrom, otherClassNames } from "@/lib/timetable/timetable-grid";

// Phase 8 / CP3 — edit one lesson of the timetable in force (§17 D24, D33, D36).
//
// Day and period are editable in the dialog, so after a clash the admin can move
// the lesson without closing it. A clash is shown in the dialog, naming the
// teacher, the OTHER class, the day, period and term; nothing was saved.

const FIELD =
  "h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export interface LessonTarget {
  dayOfWeek: number;
  bellSlotId: string;
  lesson: LessonDto | null;
  span: number;
}

export function LessonEditorModal({
  target,
  view,
  className,
  subjects,
  onClose,
  onSaved,
}: {
  target: LessonTarget | null;
  view: TimetableViewDto;
  className: string;
  subjects: SubjectDto[];
  onClose: () => void;
  onSaved: (warnings: AssignmentWarningDto[]) => Promise<void>;
}) {
  const timetableId = view.inForce?.id ?? "";
  const lessonSlots = view.slots.filter((s) => s.kind === "LESSON");

  const [day, setDay] = useState(1);
  const [slotId, setSlotId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [span, setSpan] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<TimetableClashDto[] | null>(null);

  useEffect(() => {
    if (!target) return;
    setDay(target.dayOfWeek);
    setSlotId(target.bellSlotId);
    setSubjectId(target.lesson?.subjectId ?? "");
    setTeacherIds(target.lesson?.teachers.map((t) => t.id) ?? []);
    setSpan(target.span);
    setError(null);
    setClashes(null);
  }, [target]);

  // D33: offer the teachers assigned to this subject in this class. Show whether
  // an assignment covers the whole year or one term.
  const teacherChoices = useMemo(() => {
    const byTeacher = new Map<string, { id: string; name: string; scopes: Array<string | null> }>();
    for (const a of view.assignments.filter((x) => x.subjectId === subjectId)) {
      const entry = byTeacher.get(a.teacherId) ?? { id: a.teacherId, name: a.teacherName, scopes: [] };
      entry.scopes.push(a.termId);
      byTeacher.set(a.teacherId, entry);
    }
    // A teacher already on the lesson stays listed even without an assignment.
    for (const t of target?.lesson?.teachers ?? []) {
      if (!byTeacher.has(t.id)) byTeacher.set(t.id, { id: t.id, name: t.name, scopes: [] });
    }
    return [...byTeacher.values()].sort((x, y) => x.name.localeCompare(y.name));
  }, [view.assignments, subjectId, target]);

  const maxSpan = maxSpanFrom(view.slots, slotId);

  async function submit() {
    if (!subjectId) {
      setError("Choose a subject.");
      return;
    }
    setBusy(true);
    setError(null);
    setClashes(null);
    try {
      const newSpan = Math.min(span, maxSpan);
      const r = await saveLesson({
        timetableId,
        dayOfWeek: day,
        bellSlotId: slotId,
        subjectId,
        teacherIds: teacherIds.filter((id) => teacherChoices.some((t) => t.id === id)),
        span: newSpan,
      });
      // A MOVE: the new cells saved (and passed the clash check), so clear the
      // old block's cells that the new block does not cover. Two requests, not
      // one transaction — if a clear fails the lesson is briefly in both places,
      // which is visible and fixable, never a hidden clash.
      if (target?.lesson && (target.dayOfWeek !== day || target.bellSlotId !== slotId)) {
        const oldStart = view.slots.findIndex((s) => s.id === target.bellSlotId);
        const newStart = view.slots.findIndex((s) => s.id === slotId);
        const oldIds = view.slots.slice(oldStart, oldStart + target.span).map((s) => s.id);
        const newIds = new Set(view.slots.slice(newStart, newStart + newSpan).map((s) => s.id));
        for (const id of oldIds) {
          if (target.dayOfWeek === day && newIds.has(id)) continue;
          await clearLesson({ timetableId, dayOfWeek: target.dayOfWeek, bellSlotId: id });
        }
      }
      await onSaved(r.warnings);
    } catch (e) {
      const c = clashesOf(e);
      if (c) setClashes(c);
      else setError(e instanceof ApiError ? e.message : "Could not save the lesson.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      // Clear the whole merged block (a double period is several stored lessons).
      const start = view.slots.findIndex((s) => s.id === target!.bellSlotId);
      for (const s of view.slots.slice(start, start + target!.span)) {
        await clearLesson({ timetableId, dayOfWeek: target!.dayOfWeek, bellSlotId: s.id });
      }
      await onSaved([]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not clear the lesson.");
    } finally {
      setBusy(false);
    }
  }

  const firstClash = clashes?.[0];

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.lesson ? "Edit lesson" : "Add lesson"} — {className}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {firstClash && (
            <InlineAlert title="Timetable clash — nothing was saved">
              <p>
                {firstClash.teacherName} already teaches{" "}
                <strong>{otherClassNames(firstClash, view.classArmId).join(", ")}</strong> on{" "}
                {ISO_WEEKDAY_LABELS[firstClash.dayOfWeek]}, {firstClash.slotLabel} ({firstClash.termName}).
              </p>
              {clashes!.length > 1 && (
                <p className="mt-1">
                  Also clashes in: {[...new Set(clashes!.slice(1).map((c) => `${c.termName}${c.teacherId !== firstClash.teacherId ? ` (${c.teacherName})` : ""}`))].join(", ")}.
                </p>
              )}
              <p className="mt-1">Pick another day or period, or another teacher.</p>
            </InlineAlert>
          )}
          {error && <InlineAlert>{error}</InlineAlert>}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Day</span>
              <select aria-label="Day" className={FIELD} value={day} onChange={(e) => setDay(Number(e.target.value))}>
                {view.schoolWeekDays.map((d) => (
                  <option key={d} value={d}>
                    {ISO_WEEKDAY_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Period</span>
              <select aria-label="Period" className={FIELD} value={slotId} onChange={(e) => setSlotId(e.target.value)}>
                {lessonSlots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Subject</span>
            <select
              aria-label="Subject"
              className={FIELD}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                setTeacherIds([]);
              }}
            >
              <option value="">Choose a subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="font-medium">Teacher(s)</legend>
            {subjectId && teacherChoices.length === 0 && (
              <p className="text-muted-foreground">
                Nobody is assigned to teach this subject in {className}. You can save it with no teacher for now.
              </p>
            )}
            {teacherChoices.map((t) => (
              <label key={t.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={teacherIds.includes(t.id)}
                  onChange={(e) => setTeacherIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
                />
                <span>{t.name}</span>
                {t.scopes.length > 0 && !t.scopes.includes(null) && (
                  <span className="text-xs text-muted-foreground">(assigned for {t.scopes.length === 1 ? "one term" : `${t.scopes.length} terms`} only)</span>
                )}
                {t.scopes.length === 0 && <span className="text-xs text-muted-foreground">(no current assignment)</span>}
              </label>
            ))}
          </fieldset>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Length</span>
            <select aria-label="Length" className={FIELD} value={Math.min(span, maxSpan)} onChange={(e) => setSpan(Number(e.target.value))}>
              {Array.from({ length: maxSpan }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 period" : `${n} periods (double${n > 2 ? "+" : ""})`}
                </option>
              ))}
            </select>
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {target?.lesson && (
              <Button type="button" variant="outline" onClick={() => void clear()} disabled={busy}>
                Clear lesson
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Save lesson
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
