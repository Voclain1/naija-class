import { createHash } from "node:crypto";

import type { PublishedGridDto } from "@school-kit/types";

import type { TenantDb } from "./timetable-clash.js";

// Phase 8 / CP4 — THE snapshot builder (docs/modules/phase-8.md §18 D45).
//
// Publish stores what this function returns, and the builder's "unpublished
// changes" status compares against what this function returns NOW. One function
// for both, on purpose: if publish and the comparison built their grids
// separately, "up to date" would stop meaning "families see exactly this" the
// first time one of them changed.
//
// The grid is self-contained and deterministic (sorted, fixed key order), so its
// sha256 is a faithful content fingerprint.

export interface LiveSnapshot {
  /** The timetable in force for (class, term), or null when the class has none. */
  timetableId: string | null;
  lessonCount: number;
  grid: PublishedGridDto;
  hash: string;
}

/** The timetable IN FORCE for one ACTIVE class in one term (D3/D13, D44): its term override, else its year-wide timetable. */
export async function inForceTimetableId(
  db: TenantDb,
  schoolId: string,
  classArmId: string,
  termId: string,
): Promise<string | null> {
  const term = await db.term.findFirst({ where: { id: termId, schoolId }, select: { academicYearId: true } });
  if (!term) return null;
  const arm = await db.classArm.findFirst({ where: { id: classArmId, schoolId, isActive: true }, select: { id: true } });
  if (!arm) return null;
  const headers = await db.timetable.findMany({
    where: { schoolId, classArmId, academicYearId: term.academicYearId, OR: [{ termId }, { termId: null }] },
    select: { id: true, termId: true },
  });
  return (headers.find((h) => h.termId === termId) ?? headers.find((h) => h.termId === null))?.id ?? null;
}

export function hashGrid(grid: PublishedGridDto): string {
  return createHash("sha256").update(JSON.stringify(grid)).digest("hex");
}

export async function buildLiveSnapshot(
  db: TenantDb,
  schoolId: string,
  classArmId: string,
  termId: string,
): Promise<LiveSnapshot> {
  const [timetableId, slots, school] = await Promise.all([
    inForceTimetableId(db, schoolId, classArmId, termId),
    db.bellSlot.findMany({
      where: { schoolId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, label: true, kind: true, startMinute: true, endMinute: true },
    }),
    db.school.findUnique({ where: { id: schoolId }, select: { schoolWeekDays: true } }),
  ]);

  const entries = timetableId
    ? await db.timetableEntry.findMany({
        where: { schoolId, timetableId },
        select: {
          dayOfWeek: true,
          bellSlotId: true,
          subject: { select: { name: true } },
          teachers: { select: { teacher: { select: { firstName: true, lastName: true } } } },
        },
      })
    : [];

  const positionOf = new Map(slots.map((s) => [s.id, s.position]));
  // Explicit key order in every object literal below: the hash depends on it.
  const grid: PublishedGridDto = {
    slots: slots.map((s) => ({
      position: s.position,
      label: s.label,
      kind: s.kind,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
    })),
    days: [...(school?.schoolWeekDays ?? [])].sort((a, b) => a - b),
    lessons: entries
      .map((e) => ({
        dayOfWeek: e.dayOfWeek,
        slotPosition: positionOf.get(e.bellSlotId) ?? 0,
        subjectName: e.subject.name,
        // Display names only (Q40): no ids, no contact details.
        teacherNames: e.teachers.map((t) => `${t.teacher.firstName} ${t.teacher.lastName}`).sort(),
      }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.slotPosition - b.slotPosition),
  };
  return { timetableId, lessonCount: entries.length, grid, hash: hashGrid(grid) };
}
