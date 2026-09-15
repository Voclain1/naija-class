import type { PublishedGridDto } from "./timetable-lifecycle.dto.js";
import type { TimetableClashDto } from "./timetable.dto.js";
import { ISO_WEEKDAY_LABELS } from "./timetable.dto.js";

// Phase 8 / CP4 — pure helpers shared by apps/web, apps/portal and apps/mobile
// (docs/modules/phase-8.md §18). No React, no Intl: the same output in Node,
// browsers and Hermes.

type PublishedLesson = PublishedGridDto["lessons"][number];

export type PublishedCell =
  | { type: "lesson"; lesson: PublishedLesson; rowSpan: number }
  | { type: "empty" }
  | { type: "covered" } // swallowed by a double period above
  | { type: "break" }; // a non-lesson period row

export interface PublishedRow {
  slot: PublishedGridDto["slots"][number];
  cells: PublishedCell[]; // one per grid.days entry, same order
}

const sameLesson = (a: PublishedLesson, b: PublishedLesson) =>
  a.subjectName === b.subjectName && a.teacherNames.join("|") === b.teacherNames.join("|");

/**
 * Rows = periods, columns = school days. Consecutive LESSON periods holding the
 * same subject and teachers merge into one cell (a double period, D24) — decided
 * here, at display, exactly as the admin builder does.
 */
export function publishedGridRows(grid: PublishedGridDto): PublishedRow[] {
  const at = new Map(grid.lessons.map((l) => [`${l.dayOfWeek}|${l.slotPosition}`, l]));
  const rows: PublishedRow[] = grid.slots.map((slot) => ({
    slot,
    cells: grid.days.map((): PublishedCell => (slot.kind === "LESSON" ? { type: "empty" } : { type: "break" })),
  }));
  grid.days.forEach((day, di) => {
    for (let si = 0; si < grid.slots.length; si++) {
      const slot = grid.slots[si]!;
      const lesson = at.get(`${day}|${slot.position}`);
      if (!lesson || slot.kind !== "LESSON") continue;
      let span = 1;
      while (si + span < grid.slots.length) {
        const next = grid.slots[si + span]!;
        const nextLesson = at.get(`${day}|${next.position}`);
        if (next.kind !== "LESSON" || !nextLesson || !sameLesson(nextLesson, lesson)) break;
        rows[si + span]!.cells[di] = { type: "covered" };
        span++;
      }
      rows[si]!.cells[di] = { type: "lesson", lesson, rowSpan: span };
      si += span - 1;
    }
  });
  return rows;
}

/** A day's lessons in order, doubles merged — the phone layout, one day at a time. */
export function publishedDay(grid: PublishedGridDto, dayOfWeek: number): Array<{ slot: PublishedGridDto["slots"][number]; endMinute: number; lesson: PublishedLesson | null }> {
  const di = grid.days.indexOf(dayOfWeek);
  if (di === -1) return [];
  const rows = publishedGridRows(grid);
  const out: Array<{ slot: PublishedGridDto["slots"][number]; endMinute: number; lesson: PublishedLesson | null }> = [];
  rows.forEach((row, si) => {
    const cell = row.cells[di]!;
    if (cell.type === "covered") return;
    if (cell.type === "lesson") {
      out.push({ slot: row.slot, endMinute: rows[si + cell.rowSpan - 1]!.slot.endMinute, lesson: cell.lesson });
    } else {
      out.push({ slot: row.slot, endMinute: row.slot.endMinute, lesson: null });
    }
  });
  return out;
}

/** "Tunde Bello — JSS 1A and JSS 1B, Monday P1 (Third Term)" — one line per clash, for warnings (D43). */
export function describeTimetableClash(c: TimetableClashDto): string {
  return `${c.teacherName} — ${c.classArms.map((a) => a.name).join(" and ")}, ${ISO_WEEKDAY_LABELS[c.dayOfWeek]} ${c.slotLabel} (${c.termName})`;
}
