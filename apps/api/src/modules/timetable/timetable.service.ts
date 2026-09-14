import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ISO_WEEKDAY_LABELS,
  NotFoundError,
  TIMETABLE_ERROR_CODES,
  ValidationError,
  formatMinuteOfDay,
  type AssignmentWarningDto,
  type BellScheduleDto,
  type BellSlotDto,
  type ClearLessonInput,
  type CreateTimetableInput,
  type LessonDto,
  type SaveBellScheduleInput,
  type SaveLessonInput,
  type SaveLessonResultDto,
  type TimetableAssignmentDto,
  type TimetableClashDto,
  type TimetableHeaderDto,
  type TimetableOptionsDto,
  type TimetableQuery,
  type TimetableViewDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { findTimetableClashes, lockSchoolTimetables, type TenantDb } from "./timetable-clash.js";

// Phase 8 / CP3 — Timetable builder. Plan-first: docs/modules/phase-8.md §17.
//
// EVERY MUTATION has the same shape (D31/D32), via runMutation():
//   1. take the school's timetable advisory lock — FIRST statement;
//   2. apply the change;
//   3. for changes that can create a clash, run THE clash query for the
//      affected academic year, and throw TIMETABLE_CLASH if it returns a row —
//      the whole transaction, audit row included, rolls back;
//   4. audit, commit.
// Checking by re-reading the result, not by reasoning about "what could this
// change affect", is the point: one query answers for every operation.
//
// Operations that skip step 3, each for a stated reason:
//   * bell schedule / school week save — clashes are slot IDENTITY matches, so
//     slot times cannot create or remove one (§17.2); removing a used slot or
//     day is refused outright;
//   * clearing a lesson — removal only removes lessons;
//   * deleting a YEAR-WIDE timetable — likewise only removes lessons. (Deleting
//     a TERM timetable is different: the year-wide one comes back into force
//     for that term and may clash — §17.4 rule 1.)

interface RequestContext {
  ipAddress: string | null;
}

// Owner/admin only at the service gate (D35). Kept as one constant so the
// role assertion and the seeded timetable.manage grant cannot drift —
// rbac-two-gate-conformance.spec.ts checks they agree.
const TIMETABLE_MANAGER_ROLES = ["owner", "admin"] as const;

/** Mutations serialise behind the lock; give them the dashboard's proven budget rather than 5 s. */
export const TIMETABLE_TRANSACTION_TIMEOUT_MS = 15_000;

const AUDIT = {
  bellScheduleSave: "timetable.bell-schedule.save",
  timetableCreate: "timetable.create",
  timetableDelete: "timetable.delete",
  lessonSave: "timetable.lesson.save",
  lessonClear: "timetable.lesson.clear",
} as const;

const C = TIMETABLE_ERROR_CODES;

/** "Tunde Bello would be teaching JSS 1A and JSS 1B at the same time — Monday, P1, First Term." */
function describeClash(c: TimetableClashDto): string {
  const classes = c.classArms.map((a) => a.name).join(" and ");
  return `${c.teacherName} would be teaching ${classes} at the same time — ${ISO_WEEKDAY_LABELS[c.dayOfWeek]}, ${c.slotLabel}, ${c.termName}.`;
}

type CheckClashes = (academicYearId: string) => Promise<void>;

@Injectable()
export class TimetableService {
  // -------------------------------------------------------------------------
  // Test seams, in the manner of CompletenessService.todayFn. Production never
  // reassigns them. timetable-concurrency.spec.ts replaces lockFn with a no-op
  // to PROVE the lock matters, and uses afterWriteHook to line two transactions
  // up at the dangerous moment: after their writes, before their clash checks.
  // -------------------------------------------------------------------------
  lockFn: (db: TenantDb, schoolId: string) => Promise<void> = lockSchoolTimetables;
  clashFn: (db: TenantDb, schoolId: string, academicYearId: string) => Promise<TimetableClashDto[]> =
    findTimetableClashes;
  afterWriteHook: (() => Promise<void>) | null = null;

  private async runMutation<T>(
    authCtx: AuthContext,
    label: string,
    body: (db: TenantDb, checkClashes: CheckClashes) => Promise<T>,
  ): Promise<T> {
    // The owner/admin + isActive gate is asserted in each PUBLIC mutation method
    // before calling here, not in this helper: rbac-two-gate-conformance.spec.ts
    // reads the gate from the method the controller calls, and a gate hidden in
    // a shared helper would be invisible to it.
    const schoolId = authCtx.schoolId;

    return withTenant(
      schoolId,
      async (db) => {
        await this.lockFn(db, schoolId);
        const checkClashes: CheckClashes = async (academicYearId) => {
          if (this.afterWriteHook) await this.afterWriteHook();
          const clashes = await this.clashFn(db, schoolId, academicYearId);
          const first = clashes[0];
          if (first) throw new ConflictError(C.CLASH, describeClash(first), { clashes });
        };
        return body(db, checkClashes);
      },
      { timeoutMs: TIMETABLE_TRANSACTION_TIMEOUT_MS, label },
    );
  }

  // =========================================================================
  // Bell schedule + school week (D26, D34)
  // =========================================================================

  async getBellSchedule(authCtx: AuthContext): Promise<BellScheduleDto> {
    return withTenant(authCtx.schoolId, (db) => this.loadBellSchedule(db, authCtx.schoolId));
  }

  private async loadBellSchedule(db: TenantDb, schoolId: string): Promise<BellScheduleDto> {
    const [slots, counts, school] = await Promise.all([
      db.bellSlot.findMany({
        where: { schoolId },
        orderBy: { position: "asc" },
        select: { id: true, position: true, label: true, kind: true, startMinute: true, endMinute: true },
      }),
      db.timetableEntry.groupBy({ by: ["bellSlotId"], where: { schoolId }, _count: { _all: true } }),
      db.school.findUnique({ where: { id: schoolId }, select: { schoolWeekDays: true } }),
    ]);
    const countBySlot = new Map(counts.map((c) => [c.bellSlotId, c._count._all]));
    return {
      slots: slots.map((s): BellSlotDto => ({ ...s, lessonCount: countBySlot.get(s.id) ?? 0 })),
      schoolWeekDays: [...(school?.schoolWeekDays ?? [1, 2, 3, 4, 5])].sort((a, b) => a - b),
    };
  }

  async saveBellSchedule(
    authCtx: AuthContext,
    input: SaveBellScheduleInput,
    reqCtx: RequestContext,
  ): Promise<BellScheduleDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runMutation(authCtx, "timetable.saveBellSchedule", async (db) => {
      const schoolId = authCtx.schoolId;
      const before = await this.loadBellSchedule(db, schoolId);
      const existing = new Map(before.slots.map((s) => [s.id, s]));

      // Re-checked here, not only in the Zod schema: the schedule's meaning
      // ("same slot" = "same time") depends on it.
      for (let i = 1; i < input.slots.length; i++) {
        const prev = input.slots[i - 1]!;
        const cur = input.slots[i]!;
        if (prev.endMinute > cur.startMinute) {
          throw new ValidationError(
            "BELL_SLOTS_OVERLAP",
            `${cur.label} starts at ${formatMinuteOfDay(cur.startMinute)}, before ${prev.label} ends at ${formatMinuteOfDay(prev.endMinute)}.`,
          );
        }
      }

      const keptIds = new Set<string>();
      for (const s of input.slots) {
        if (!s.id) continue;
        const old = existing.get(s.id);
        if (!old) throw new NotFoundError("Period not found.");
        keptIds.add(s.id);
        if (old.kind === "LESSON" && s.kind !== "LESSON" && old.lessonCount > 0) {
          throw new ConflictError(
            C.SLOT_IN_USE,
            `${old.label} has ${old.lessonCount} lesson${old.lessonCount === 1 ? "" : "s"} on the timetable. Clear them before making it a ${s.kind.toLowerCase()}.`,
            { bellSlotId: old.id, lessonCount: old.lessonCount },
          );
        }
      }
      const removed = before.slots.filter((s) => !keptIds.has(s.id));
      for (const r of removed) {
        if (r.lessonCount > 0) {
          throw new ConflictError(
            C.SLOT_IN_USE,
            `${r.label} has ${r.lessonCount} lesson${r.lessonCount === 1 ? "" : "s"} on the timetable. Clear them before removing it.`,
            { bellSlotId: r.id, lessonCount: r.lessonCount },
          );
        }
      }

      const newWeek = [...input.schoolWeekDays].sort((a, b) => a - b);
      const droppedDays = before.schoolWeekDays.filter((d) => !newWeek.includes(d));
      if (droppedDays.length > 0) {
        const used = await db.timetableEntry.groupBy({
          by: ["dayOfWeek"],
          where: { schoolId, dayOfWeek: { in: droppedDays } },
          _count: { _all: true },
        });
        const firstUsed = used[0];
        if (firstUsed) {
          throw new ConflictError(
            C.DAY_IN_USE,
            `${ISO_WEEKDAY_LABELS[firstUsed.dayOfWeek]} has ${firstUsed._count._all} lesson${firstUsed._count._all === 1 ? "" : "s"} on the timetable. Clear them before removing the day.`,
            { dayOfWeek: firstUsed.dayOfWeek, lessonCount: firstUsed._count._all },
          );
        }
      }

      // Apply. Positions are shifted out of the way first so a reorder cannot
      // collide with UNIQUE (school_id, position) midway.
      if (removed.length > 0) {
        await db.bellSlot.deleteMany({ where: { schoolId, id: { in: removed.map((r) => r.id) } } });
      }
      if (keptIds.size > 0) {
        await db.bellSlot.updateMany({ where: { schoolId, id: { in: [...keptIds] } }, data: { position: { increment: 1000 } } });
      }
      for (const [i, s] of input.slots.entries()) {
        const data = { position: i + 1, label: s.label, kind: s.kind, startMinute: s.startMinute, endMinute: s.endMinute };
        if (s.id) await db.bellSlot.update({ where: { id: s.id }, data });
        else await db.bellSlot.create({ data: { schoolId, ...data } });
      }
      await db.school.update({ where: { id: schoolId }, data: { schoolWeekDays: newWeek } });

      // No clash check: see the header — slot times cannot create a clash.
      const after = await this.loadBellSchedule(db, schoolId);
      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.bellScheduleSave,
          entityType: "school",
          entityId: schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            before: { slots: before.slots.map(({ lessonCount: _n, ...s }) => s), schoolWeekDays: before.schoolWeekDays },
            after: { slots: after.slots.map(({ lessonCount: _n, ...s }) => s), schoolWeekDays: after.schoolWeekDays },
          },
        },
      });
      return after;
    });
  }

  // =========================================================================
  // Reads for the builder
  // =========================================================================

  async getOptions(authCtx: AuthContext): Promise<TimetableOptionsDto> {
    const schoolId = authCtx.schoolId;
    return withTenant(schoolId, async (db) => {
      const [years, arms] = await Promise.all([
        db.academicYear.findMany({
          where: { schoolId },
          orderBy: { startDate: "desc" },
          select: {
            id: true,
            label: true,
            isCurrent: true,
            terms: {
              orderBy: { sequence: "asc" },
              select: { id: true, name: true, sequence: true, isCurrent: true },
            },
          },
        }),
        db.classArm.findMany({
          where: { schoolId, isActive: true },
          orderBy: [{ classLevel: { orderIndex: "asc" } }, { name: "asc" }],
          select: { id: true, name: true },
        }),
      ]);
      return { academicYears: years, classArms: arms };
    });
  }

  async getView(authCtx: AuthContext, query: TimetableQuery): Promise<TimetableViewDto> {
    const schoolId = authCtx.schoolId;
    return withTenant(schoolId, async (db) => {
      const [term, arm] = await Promise.all([
        db.term.findFirst({ where: { id: query.termId, schoolId }, select: { id: true, academicYearId: true } }),
        db.classArm.findFirst({ where: { id: query.classArmId, schoolId }, select: { id: true } }),
      ]);
      if (!term) throw new NotFoundError("Term not found.");
      if (!arm) throw new NotFoundError("Class not found.");

      const headers = await db.timetable.findMany({
        where: {
          schoolId,
          classArmId: arm.id,
          academicYearId: term.academicYearId,
          OR: [{ termId: null }, { termId: term.id }],
        },
        select: { id: true, classArmId: true, academicYearId: true, termId: true },
      });
      const yearWide = headers.find((h) => h.termId === null) ?? null;
      const termOnly = headers.find((h) => h.termId === term.id) ?? null;
      const inForce = termOnly ?? yearWide;

      const [lessons, schedule, assignments] = await Promise.all([
        inForce ? this.loadLessons(db, schoolId, inForce.id) : Promise.resolve([]),
        this.loadBellSchedule(db, schoolId),
        db.teacherAssignment.findMany({
          where: {
            schoolId,
            classArmId: arm.id,
            academicYearId: term.academicYearId,
            isActive: true,
            teacher: { isActive: true },
          },
          select: {
            teacherId: true,
            subjectId: true,
            termId: true,
            teacher: { select: { firstName: true, lastName: true } },
            subject: { select: { name: true } },
          },
        }),
      ]);

      return {
        classArmId: arm.id,
        termId: term.id,
        academicYearId: term.academicYearId,
        inForce,
        yearWide,
        termOnly,
        lessons,
        slots: schedule.slots,
        schoolWeekDays: schedule.schoolWeekDays,
        assignments: assignments
          .map((a): TimetableAssignmentDto => ({
            teacherId: a.teacherId,
            teacherName: `${a.teacher.firstName} ${a.teacher.lastName}`,
            subjectId: a.subjectId,
            subjectName: a.subject.name,
            termId: a.termId,
          }))
          .sort((x, y) => x.subjectName.localeCompare(y.subjectName) || x.teacherName.localeCompare(y.teacherName)),
      };
    });
  }

  private async loadLessons(db: TenantDb, schoolId: string, timetableId: string): Promise<LessonDto[]> {
    const rows = await db.timetableEntry.findMany({
      where: { schoolId, timetableId },
      orderBy: [{ dayOfWeek: "asc" }, { bellSlot: { position: "asc" } }],
      select: {
        id: true,
        dayOfWeek: true,
        bellSlotId: true,
        subjectId: true,
        subject: { select: { name: true } },
        teachers: {
          select: { teacher: { select: { id: true, firstName: true, lastName: true } } },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      dayOfWeek: r.dayOfWeek,
      bellSlotId: r.bellSlotId,
      subjectId: r.subjectId,
      subjectName: r.subject.name,
      teachers: r.teachers
        .map((t) => ({ id: t.teacher.id, name: `${t.teacher.firstName} ${t.teacher.lastName}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }

  // =========================================================================
  // Timetable headers (D3)
  // =========================================================================

  async createTimetable(
    authCtx: AuthContext,
    input: CreateTimetableInput,
    reqCtx: RequestContext,
  ): Promise<TimetableHeaderDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runMutation(authCtx, "timetable.createTimetable", async (db, checkClashes) => {
      const schoolId = authCtx.schoolId;
      const [arm, year] = await Promise.all([
        db.classArm.findFirst({ where: { id: input.classArmId, schoolId, isActive: true }, select: { id: true, name: true } }),
        db.academicYear.findFirst({
          where: { id: input.academicYearId, schoolId },
          select: { id: true, terms: { select: { id: true } } },
        }),
      ]);
      if (!arm) throw new NotFoundError("Class not found.");
      if (!year) throw new NotFoundError("Academic year not found.");
      // A year-wide timetable is in force only in its year's terms (§17.4 rule 4).
      // With no terms it would be in force nowhere, so nothing could be clash-
      // checked — refuse rather than let unchecked lessons accumulate.
      if (year.terms.length === 0) {
        throw new ValidationError(C.YEAR_HAS_NO_TERMS, "Add this academic year's terms before building a timetable.");
      }
      if (input.termId !== null) {
        const term = await db.term.findFirst({ where: { id: input.termId, schoolId }, select: { academicYearId: true } });
        if (!term) throw new NotFoundError("Term not found.");
        if (term.academicYearId !== year.id) {
          throw new ValidationError(C.TERM_NOT_IN_YEAR, "That term does not belong to the selected academic year.");
        }
      }

      // Pre-checked under the lock, so no concurrent create can slip between
      // this read and the insert. (A P2002 under FORCE RLS would not say which
      // index fired.) The partial unique indexes remain the backstop.
      const clash = await db.timetable.findFirst({
        where: { schoolId, classArmId: arm.id, academicYearId: year.id, termId: input.termId },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictError(
          C.TIMETABLE_EXISTS,
          input.termId === null
            ? `${arm.name} already has a whole-year timetable.`
            : `${arm.name} already has a timetable for this term.`,
          { timetableId: clash.id },
        );
      }

      const created = await db.timetable.create({
        data: {
          schoolId,
          classArmId: arm.id,
          academicYearId: year.id,
          termId: input.termId,
          createdBy: authCtx.userId,
        },
        select: { id: true, classArmId: true, academicYearId: true, termId: true },
      });

      // A term timetable changes what is in force for its term (D31).
      await checkClashes(year.id);

      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.timetableCreate,
          entityType: "timetable",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { classArmId: arm.id, academicYearId: year.id, termId: input.termId },
        },
      });
      return created;
    });
  }

  async deleteTimetable(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    await this.runMutation(authCtx, "timetable.deleteTimetable", async (db, checkClashes) => {
      const schoolId = authCtx.schoolId;
      const existing = await db.timetable.findFirst({
        where: { id, schoolId },
        select: { id: true, classArmId: true, academicYearId: true, termId: true, _count: { select: { entries: true } } },
      });
      if (!existing) throw new NotFoundError("Timetable not found.");

      await db.timetable.delete({ where: { id: existing.id } });

      // §17.4 rule 1: deleting a TERM timetable brings the year-wide one back
      // into force for that term, which can clash with another class. A
      // year-wide delete only removes lessons, so it cannot.
      if (existing.termId !== null) await checkClashes(existing.academicYearId);

      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.timetableDelete,
          entityType: "timetable",
          entityId: existing.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classArmId: existing.classArmId,
            academicYearId: existing.academicYearId,
            termId: existing.termId,
            lessonCount: existing._count.entries,
          },
        },
      });
    });
  }

  // =========================================================================
  // Lessons (D24, D33)
  // =========================================================================

  async saveLesson(authCtx: AuthContext, input: SaveLessonInput, reqCtx: RequestContext): Promise<SaveLessonResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runMutation(authCtx, "timetable.saveLesson", async (db, checkClashes) => {
      const schoolId = authCtx.schoolId;
      const timetable = await db.timetable.findFirst({
        where: { id: input.timetableId, schoolId },
        select: { id: true, classArmId: true, academicYearId: true, termId: true },
      });
      if (!timetable) throw new NotFoundError("Timetable not found.");

      const [school, slots, subject] = await Promise.all([
        db.school.findUnique({ where: { id: schoolId }, select: { schoolWeekDays: true } }),
        db.bellSlot.findMany({
          where: { schoolId },
          orderBy: { position: "asc" },
          select: { id: true, label: true, kind: true },
        }),
        db.subject.findFirst({ where: { id: input.subjectId, schoolId }, select: { id: true, name: true } }),
      ]);
      if (!subject) throw new NotFoundError("Subject not found.");
      if (!(school?.schoolWeekDays ?? []).includes(input.dayOfWeek)) {
        throw new ValidationError(C.NOT_A_SCHOOL_DAY, `${ISO_WEEKDAY_LABELS[input.dayOfWeek]} is not in the school week.`);
      }

      // D24: a double period is N consecutive LESSON slots.
      const start = slots.findIndex((s) => s.id === input.bellSlotId);
      if (start === -1) throw new NotFoundError("Period not found.");
      const span = input.span ?? 1;
      const spanned = slots.slice(start, start + span);
      if (spanned.length < span) {
        throw new ValidationError(C.SPAN_OUT_OF_RANGE, `There are not ${span} periods left in the day from ${slots[start]!.label}.`);
      }
      const notLesson = spanned.find((s) => s.kind !== "LESSON");
      if (notLesson) {
        throw new ValidationError(C.NOT_A_LESSON_SLOT, `${notLesson.label} is not a lesson period.`);
      }
      const spannedIds = spanned.map((s) => s.id);

      // Cells: the first may be replaced (editing). The rest must be empty, or
      // hold the SAME lesson as the first — the rest of the block being edited.
      const occupants = await db.timetableEntry.findMany({
        where: { schoolId, timetableId: timetable.id, dayOfWeek: input.dayOfWeek, bellSlotId: { in: spannedIds } },
        select: {
          id: true,
          bellSlotId: true,
          subjectId: true,
          subject: { select: { name: true } },
          teachers: { select: { teacherId: true } },
        },
      });
      const signature = (o: (typeof occupants)[number]) =>
        `${o.subjectId}|${o.teachers.map((t) => t.teacherId).sort().join(",")}`;
      const first = occupants.find((o) => o.bellSlotId === input.bellSlotId);
      for (const o of occupants) {
        if (o.bellSlotId === input.bellSlotId) continue;
        if (!first || signature(o) !== signature(first)) {
          const slot = slots.find((s) => s.id === o.bellSlotId)!;
          throw new ConflictError(
            C.CELL_OCCUPIED,
            `${slot.label} on ${ISO_WEEKDAY_LABELS[input.dayOfWeek]} already has ${o.subject.name}. Clear it first.`,
            { bellSlotId: o.bellSlotId },
          );
        }
      }

      const teacherIds = [...new Set(input.teacherIds)];
      const warnings = await this.checkAssignments(db, schoolId, timetable, subject.id, teacherIds);

      if (occupants.length > 0) {
        await db.timetableEntry.deleteMany({ where: { schoolId, id: { in: occupants.map((o) => o.id) } } });
      }
      for (const slotId of spannedIds) {
        const entry = await db.timetableEntry.create({
          data: {
            schoolId,
            timetableId: timetable.id,
            dayOfWeek: input.dayOfWeek,
            bellSlotId: slotId,
            subjectId: subject.id,
            updatedBy: authCtx.userId,
          },
          select: { id: true },
        });
        if (teacherIds.length > 0) {
          await db.timetableEntryTeacher.createMany({
            data: teacherIds.map((teacherId) => ({ schoolId, entryId: entry.id, teacherId })),
          });
        }
      }

      // D31 — write, then verify.
      await checkClashes(timetable.academicYearId);

      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.lessonSave,
          entityType: "timetable",
          entityId: timetable.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            dayOfWeek: input.dayOfWeek,
            bellSlotIds: spannedIds,
            before: occupants.map((o) => ({
              bellSlotId: o.bellSlotId,
              subjectId: o.subjectId,
              teacherIds: o.teachers.map((t) => t.teacherId),
            })),
            after: { subjectId: subject.id, teacherIds },
            warnings: warnings.map((w) => ({ teacherId: w.teacherId, uncoveredTermNames: w.uncoveredTermNames })),
          },
        },
      });

      return { lessons: await this.loadLessons(db, schoolId, timetable.id), warnings };
    });
  }

  /**
   * D33 / Q36. A teacher on a lesson must hold an ACTIVE assignment for this
   * class and subject effective in the term(s) this timetable is in force:
   * in none → refused; in some but not all → saved, with a warning. An inactive
   * assignment, or an inactive teacher, counts as none.
   */
  private async checkAssignments(
    db: TenantDb,
    schoolId: string,
    timetable: { id: string; classArmId: string; academicYearId: string; termId: string | null },
    subjectId: string,
    teacherIds: string[],
  ): Promise<AssignmentWarningDto[]> {
    if (teacherIds.length === 0) return []; // Q34 — "No teacher" is allowed and cannot clash.

    const [teachers, yearTerms, replacing, assignments] = await Promise.all([
      db.user.findMany({
        where: { schoolId, id: { in: teacherIds } },
        select: { id: true, firstName: true, lastName: true, isActive: true },
      }),
      db.term.findMany({
        where: { schoolId, academicYearId: timetable.academicYearId },
        orderBy: { sequence: "asc" },
        select: { id: true, name: true },
      }),
      timetable.termId === null
        ? db.timetable.findMany({
            where: { schoolId, classArmId: timetable.classArmId, academicYearId: timetable.academicYearId, termId: { not: null } },
            select: { termId: true },
          })
        : Promise.resolve([]),
      db.teacherAssignment.findMany({
        where: {
          schoolId,
          teacherId: { in: teacherIds },
          classArmId: timetable.classArmId,
          subjectId,
          academicYearId: timetable.academicYearId,
          isActive: true,
        },
        select: { teacherId: true, termId: true },
      }),
    ]);
    if (teachers.length !== teacherIds.length) throw new NotFoundError("Teacher not found.");

    // The terms this timetable is in force: its own term, or — for a year-wide
    // timetable — every term of the year not replaced by a term timetable. If
    // every term is replaced it is in force nowhere; judge against the year.
    const replaced = new Set(replacing.map((r) => r.termId));
    let inForceTerms =
      timetable.termId !== null ? yearTerms.filter((t) => t.id === timetable.termId) : yearTerms.filter((t) => !replaced.has(t.id));
    if (inForceTerms.length === 0) inForceTerms = yearTerms;

    const warnings: AssignmentWarningDto[] = [];
    for (const teacher of teachers) {
      const name = `${teacher.firstName} ${teacher.lastName}`;
      const mine = teacher.isActive ? assignments.filter((a) => a.teacherId === teacher.id) : [];
      const covered = inForceTerms.filter((t) => mine.some((a) => a.termId === null || a.termId === t.id));
      if (covered.length === 0) {
        throw new ValidationError(
          C.TEACHER_NOT_ASSIGNED,
          `${name} is not assigned to teach this subject in this class${timetable.termId === null ? " this year" : " this term"}. Add the assignment first.`,
          { teacherId: teacher.id },
        );
      }
      if (covered.length < inForceTerms.length) {
        warnings.push({
          teacherId: teacher.id,
          teacherName: name,
          uncoveredTermNames: inForceTerms.filter((t) => !covered.includes(t)).map((t) => t.name),
        });
      }
    }
    return warnings;
  }

  async clearLesson(authCtx: AuthContext, input: ClearLessonInput, reqCtx: RequestContext): Promise<LessonDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runMutation(authCtx, "timetable.clearLesson", async (db) => {
      const schoolId = authCtx.schoolId;
      const timetable = await db.timetable.findFirst({ where: { id: input.timetableId, schoolId }, select: { id: true } });
      if (!timetable) throw new NotFoundError("Timetable not found.");

      const entry = await db.timetableEntry.findFirst({
        where: { schoolId, timetableId: timetable.id, dayOfWeek: input.dayOfWeek, bellSlotId: input.bellSlotId },
        select: { id: true, subjectId: true, teachers: { select: { teacherId: true } } },
      });
      // Idempotent: clearing an empty cell changes nothing and writes no audit row.
      if (entry) {
        await db.timetableEntry.delete({ where: { id: entry.id } });
        // No clash check: removal only removes lessons.
        await db.auditLog.create({
          data: {
            schoolId,
            userId: authCtx.userId,
            action: AUDIT.lessonClear,
            entityType: "timetable",
            entityId: timetable.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              dayOfWeek: input.dayOfWeek,
              bellSlotId: input.bellSlotId,
              before: { subjectId: entry.subjectId, teacherIds: entry.teachers.map((t) => t.teacherId) },
            },
          },
        });
      }
      return this.loadLessons(db, schoolId, timetable.id);
    });
  }
}
