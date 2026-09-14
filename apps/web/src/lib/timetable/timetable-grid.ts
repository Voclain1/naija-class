import type { BellSlotDto, LessonDto, TimetableClashDto } from "@school-kit/types";

// Phase 8 / CP3 — pure layout for the timetable grid (docs/modules/phase-8.md §17 D24, D36).
//
// Rows are the bell slots in order; columns are the school's days. A double
// period is NOT a stored concept — it is consecutive LESSON slots holding the
// same subject and teachers — so merging is decided here, at display, and
// nothing else needs to know.

export type GridCell =
  | { type: "lesson"; lesson: LessonDto; rowSpan: number }
  | { type: "empty" }
  | { type: "covered" } // swallowed by a merged lesson above
  | { type: "non-lesson" }; // a break / assembly row

const signature = (l: LessonDto) => `${l.subjectId}|${l.teachers.map((t) => t.id).sort().join(",")}`;

/** cells[slotIndex][dayIndex] */
export function buildGrid(slots: BellSlotDto[], days: number[], lessons: LessonDto[]): GridCell[][] {
  const at = new Map(lessons.map((l) => [`${l.dayOfWeek}|${l.bellSlotId}`, l]));
  const cells: GridCell[][] = slots.map((s) => days.map(() => (s.kind === "LESSON" ? { type: "empty" } : { type: "non-lesson" })));

  days.forEach((day, di) => {
    for (let si = 0; si < slots.length; si++) {
      const lesson = at.get(`${day}|${slots[si]!.id}`);
      if (!lesson || slots[si]!.kind !== "LESSON") continue;
      let span = 1;
      while (si + span < slots.length) {
        const next = slots[si + span]!;
        const nextLesson = at.get(`${day}|${next.id}`);
        if (next.kind !== "LESSON" || !nextLesson || signature(nextLesson) !== signature(lesson)) break;
        cells[si + span]![di] = { type: "covered" };
        span++;
      }
      cells[si]![di] = { type: "lesson", lesson, rowSpan: span };
      si += span - 1;
    }
  });
  return cells;
}

/** How many consecutive LESSON slots start at `slotId` — the largest span the editor may offer. */
export function maxSpanFrom(slots: BellSlotDto[], slotId: string, limit = 4): number {
  const start = slots.findIndex((s) => s.id === slotId);
  if (start === -1) return 1;
  let n = 0;
  while (start + n < slots.length && slots[start + n]!.kind === "LESSON" && n < limit) n++;
  return Math.max(1, n);
}

/** "Clashes with JSS 1A" — the OTHER classes in a clash, relative to the class being edited. */
export function otherClassNames(clash: TimetableClashDto, classArmId: string): string[] {
  return clash.classArms.filter((a) => a.id !== classArmId).map((a) => a.name);
}
