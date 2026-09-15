import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ISO_WEEKDAY_LABELS,
  LIFECYCLE_ERROR_CODES,
  NotFoundError,
  TIMETABLE_ERROR_CODES,
  ValidationError,
  formatMinuteOfDay,
  type AssignmentWarningDto,
  type BellScheduleDto,
  type BellSlotDto,
  type ClearLessonInput,
  type CopyResultDto,
  type CopyTimetableInput,
  type ForkTimetableInput,
  type PublicationStatusDto,
  type PublishResultDto,
  type TeacherRemovalDto,
  type UnassignedTeacherDto,
  type WithdrawPublicationInput,
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
import { addedClashes, findTimetableClashes, lockSchoolTimetables, type TenantDb } from "./timetable-clash.js";
import { buildLiveSnapshot, type LiveSnapshot } from "./timetable-snapshot.js";

// Phase 8 / CP3 — Timetable builder. Plan-first: docs/modules/phase-8.md §17.
//
// EVERY MUTATION has the same shape (D31/D32, amended by CP4 §18 D43), via
// runMutation():
//   1. take the school's timetable advisory lock — FIRST statement;
//   2. for changes that can create a clash, record THE clash query's result for
//      the affected academic year (clashes.begin);
//   3. apply the change;
//   4. run the query again (clashes.verify) and throw TIMETABLE_CLASH if the
//      change ADDED any clash — the whole transaction, audit row included,
//      rolls back;
//   5. audit, commit.
//
// "Must not ADD a clash" rather than "no clash may exist" (D43): a clash can come
// into force without a timetable edit (a term added to a year, a class
// re-activated), and those are surfaced where they happen. If every timetable
// edit in that year were then refused, the edits that FIX the clash would be
// refused too. No timetable edit can create a clash either way.
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
  timetableFork: "timetable.fork",
  timetableCopy: "timetable.copy",
  publish: "timetable.publish",
  withdraw: "timetable.publication.withdraw",
} as const;

const C = TIMETABLE_ERROR_CODES;
const L = LIFECYCLE_ERROR_CODES;

interface CopySource {
  id: string;
  classArmId: string;
  academicYearId: string;
  termId: string | null;
  className: string;
  entries: Array<{
    dayOfWeek: number;
    bellSlotId: string;
    slotLabel: string;
    subjectId: string;
    subjectName: string;
    teachers: Array<{ id: string; name: string; isActive: boolean }>;
  }>;
}

interface CopyOutcome {
  sourceId: string;
  className: string;
  result: CopyResultDto;
}

/** Thrown inside the transaction to roll a preview back while carrying its result out. */
class PreviewRollback extends Error {
  constructor(readonly result: CopyResultDto) {
    super("preview rollback");
  }
}

/** One sentence naming every kind of problem a refused copy has (details carries them all). */
function describeCopyProblems(o: CopyOutcome): string {
  const p = o.result.problems;
  const parts: string[] = [];
  if (p.destinationLessonCount > 0) {
    parts.push(`the destination already has ${p.destinationLessonCount} lesson${p.destinationLessonCount === 1 ? "" : "s"} (clear it first)`);
  }
  if (p.acknowledgementMismatch) parts.push("the teachers to leave off have changed since the preview (preview again)");
  if (p.unassignedTeachers.length > 0) {
    const n = new Set(p.unassignedTeachers.map((u) => u.teacherId)).size;
    parts.push(`${n} teacher${n === 1 ? " is" : "s are"} not assigned for the destination`);
  }
  if (p.clashes.length > 0) parts.push(`${p.clashes.length} clash${p.clashes.length === 1 ? "" : "es"} with other classes`);
  return `${o.className}'s timetable was not copied: ${parts.join("; ")}.`;
}

/** "Tunde Bello would be teaching JSS 1A and JSS 1B at the same time — Monday, P1, First Term." */
function describeClash(c: TimetableClashDto): string {
  const classes = c.classArms.map((a) => a.name).join(" and ");
  return `${c.teacherName} would be teaching ${classes} at the same time — ${ISO_WEEKDAY_LABELS[c.dayOfWeek]}, ${c.slotLabel}, ${c.termName}.`;
}

export interface ClashGuard {
  /** Record the year's clashes BEFORE writing. Must be called before verify(). */
  begin(academicYearId: string): Promise<void>;
  /** After writing: refuse with TIMETABLE_CLASH if the write added a clash. */
  verify(): Promise<void>;
  /** After writing: the clashes the write added, WITHOUT throwing (copy collects every problem). */
  added(): Promise<TimetableClashDto[]>;
}

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
  /** D43: which clashes a mutation is refused for. Production: the ones it ADDED. */
  clashRule: (before: TimetableClashDto[], after: TimetableClashDto[]) => TimetableClashDto[] = addedClashes;
  /** D45: the ONE snapshot builder — publish stores it, the status compares against it. */
  snapshotFn: (db: TenantDb, schoolId: string, classArmId: string, termId: string) => Promise<LiveSnapshot> = buildLiveSnapshot;
  /** D45: withdraw DELETES the publication (a flag would be a state a reader could forget). */
  withdrawFn: (db: TenantDb, publicationId: string) => Promise<void> = async (db, id) => {
    await db.timetablePublication.delete({ where: { id } });
  };

  private async runMutation<T>(
    authCtx: AuthContext,
    label: string,
    body: (db: TenantDb, clashes: ClashGuard) => Promise<T>,
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
        let yearId: string | null = null;
        let before: TimetableClashDto[] = [];
        const clashes: ClashGuard = {
          begin: async (academicYearId) => {
            yearId = academicYearId;
            before = await this.clashFn(db, schoolId, academicYearId);
          },
          added: async () => {
            // An added() without begin is a programming error, not "no clashes":
            // fail loudly so a mutation cannot silently skip its check.
            if (yearId === null) throw new Error("ClashGuard used before begin()");
            if (this.afterWriteHook) await this.afterWriteHook();
            const after = await this.clashFn(db, schoolId, yearId);
            return this.clashRule(before, after);
          },
          verify: async () => {
            const added = await clashes.added();
            const first = added[0];
            if (first) throw new ConflictError(C.CLASH, describeClash(first), { clashes: added });
          },
        };
        return body(db, clashes);
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

      const publication = await this.publicationStatus(db, schoolId, arm.id, term.id);

      return {
        classArmId: arm.id,
        termId: term.id,
        academicYearId: term.academicYearId,
        publication,
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
    return this.runMutation(authCtx, "timetable.createTimetable", async (db, clashes) => {
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

      await clashes.begin(year.id);
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
      await clashes.verify();

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
    await this.runMutation(authCtx, "timetable.deleteTimetable", async (db, clashes) => {
      const schoolId = authCtx.schoolId;
      const existing = await db.timetable.findFirst({
        where: { id, schoolId },
        select: { id: true, classArmId: true, academicYearId: true, termId: true, _count: { select: { entries: true } } },
      });
      if (!existing) throw new NotFoundError("Timetable not found.");

      // §17.4 rule 1: deleting a TERM timetable brings the year-wide one back
      // into force for that term, which can clash with another class. A
      // year-wide delete only removes lessons, so it cannot.
      const checksClashes = existing.termId !== null;
      if (checksClashes) await clashes.begin(existing.academicYearId);

      await db.timetable.delete({ where: { id: existing.id } });

      if (checksClashes) await clashes.verify();

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
    return this.runMutation(authCtx, "timetable.saveLesson", async (db, clashes) => {
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

      await clashes.begin(timetable.academicYearId);
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

      // D31: write, then verify (D43: refuse only a clash this write added).
      await clashes.verify();

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

  // =========================================================================
  // CP4 — clashes banner (D43)
  // =========================================================================

  /** Every clash in force in a year — the builder's standing banner. Same query as every check. */
  async getYearClashes(authCtx: AuthContext, academicYearId: string): Promise<TimetableClashDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const year = await db.academicYear.findFirst({ where: { id: academicYearId, schoolId: authCtx.schoolId }, select: { id: true } });
      if (!year) throw new NotFoundError("Academic year not found.");
      return this.clashFn(db, authCtx.schoolId, year.id);
    });
  }

  // =========================================================================
  // CP4 — fork and copy (D41, D42)
  //
  // Both run copyLessons(), and a PREVIEW runs the identical path inside the
  // same transaction, then throws PreviewRollback so nothing commits. A preview
  // therefore cannot drift from the copy (§18.4 rule 1).
  // =========================================================================

  async forkTimetable(
    authCtx: AuthContext,
    sourceId: string,
    input: ForkTimetableInput,
    reqCtx: RequestContext,
    options: { preview: boolean } = { preview: false },
  ): Promise<CopyResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runCopy(authCtx, "timetable.forkTimetable", options.preview, reqCtx, async (db, clashes) => {
      const schoolId = authCtx.schoolId;
      const source = await this.loadCopySource(db, schoolId, sourceId);
      if (source.termId !== null) {
        throw new ValidationError(L.NOT_YEAR_WIDE, "Only a whole-year timetable can be split into a term timetable.");
      }
      const term = await db.term.findFirst({ where: { id: input.termId, schoolId }, select: { academicYearId: true, name: true } });
      if (!term) throw new NotFoundError("Term not found.");
      if (term.academicYearId !== source.academicYearId) {
        throw new ValidationError(C.TERM_NOT_IN_YEAR, "That term does not belong to this timetable's academic year.");
      }
      // Never overwrite: a term that already has its own timetable is refused.
      const exists = await db.timetable.findFirst({
        where: { schoolId, classArmId: source.classArmId, termId: input.termId },
        select: { id: true },
      });
      if (exists) {
        throw new ConflictError(C.TIMETABLE_EXISTS, `${source.className} already has a timetable for ${term.name}.`, {
          timetableId: exists.id,
        });
      }
      return this.copyLessons(db, clashes, authCtx, source, { academicYearId: source.academicYearId, termId: input.termId }, {
        leaveOff: false,
        acknowledged: [],
      });
    });
  }

  async copyTimetable(
    authCtx: AuthContext,
    sourceId: string,
    input: CopyTimetableInput,
    reqCtx: RequestContext,
    options: { preview: boolean } = { preview: false },
  ): Promise<CopyResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runCopy(authCtx, "timetable.copyTimetable", options.preview, reqCtx, async (db, clashes) => {
      const schoolId = authCtx.schoolId;
      const source = await this.loadCopySource(db, schoolId, sourceId);
      const year = await db.academicYear.findFirst({
        where: { id: input.academicYearId, schoolId },
        select: { id: true, terms: { select: { id: true } } },
      });
      if (!year) throw new NotFoundError("Academic year not found.");
      if (year.terms.length === 0) {
        throw new ValidationError(C.YEAR_HAS_NO_TERMS, "Add this academic year's terms before copying a timetable into it.");
      }
      if (input.termId !== null && !year.terms.some((t) => t.id === input.termId)) {
        throw new ValidationError(C.TERM_NOT_IN_YEAR, "That term does not belong to the selected academic year.");
      }
      if (year.id === source.academicYearId && input.termId === source.termId) {
        throw new ValidationError(L.SAME_AS_SOURCE, "A timetable cannot be copied onto itself.");
      }
      return this.copyLessons(db, clashes, authCtx, source, { academicYearId: year.id, termId: input.termId }, {
        leaveOff: input.leaveUnassignedTeachersOff,
        acknowledged: input.acknowledgedRemovals,
      });
    });
  }

  private async runCopy(
    authCtx: AuthContext,
    label: string,
    preview: boolean,
    reqCtx: RequestContext,
    body: (db: TenantDb, clashes: ClashGuard) => Promise<CopyOutcome>,
  ): Promise<CopyResultDto> {
    try {
      return await this.runMutation(authCtx, label, async (db, clashes) => {
        const outcome = await body(db, clashes);
        // A preview reports no destination id: the header it may have created is rolled back.
        const result: CopyResultDto = { ...outcome.result, preview, timetable: preview ? null : outcome.result.timetable };
        // A preview never commits — not even the destination header.
        if (preview) throw new PreviewRollback(result);
        if (!result.ok) {
          throw new ConflictError(L.COPY_REFUSED, describeCopyProblems(outcome), { ...result.problems, removedTeachers: [] });
        }
        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: label === "timetable.forkTimetable" ? AUDIT.timetableFork : AUDIT.timetableCopy,
            entityType: "timetable",
            entityId: result.timetable!.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              sourceTimetableId: outcome.sourceId,
              destination: { academicYearId: result.timetable!.academicYearId, termId: result.timetable!.termId },
              lessonsCopied: result.lessonsCopied,
              removedTeachers: result.removedTeachers.map((r) => ({ dayOfWeek: r.dayOfWeek, bellSlotId: r.bellSlotId, teacherId: r.teacherId })),
            },
          },
        });
        return result;
      });
    } catch (e) {
      if (e instanceof PreviewRollback) return e.result;
      throw e;
    }
  }

  private async loadCopySource(db: TenantDb, schoolId: string, sourceId: string): Promise<CopySource> {
    const t = await db.timetable.findFirst({
      where: { id: sourceId, schoolId },
      select: {
        id: true,
        classArmId: true,
        academicYearId: true,
        termId: true,
        classArm: { select: { name: true, isActive: true } },
        entries: {
          select: {
            dayOfWeek: true,
            bellSlotId: true,
            subjectId: true,
            bellSlot: { select: { label: true } },
            subject: { select: { name: true } },
            teachers: { select: { teacher: { select: { id: true, firstName: true, lastName: true, isActive: true } } } },
          },
        },
      },
    });
    // An inactive class has no builder surface (D44), so it cannot be a copy source either.
    if (!t || !t.classArm.isActive) throw new NotFoundError("Timetable not found.");
    return {
      id: t.id,
      classArmId: t.classArmId,
      academicYearId: t.academicYearId,
      termId: t.termId,
      className: t.classArm.name,
      entries: t.entries.map((e) => ({
        dayOfWeek: e.dayOfWeek,
        bellSlotId: e.bellSlotId,
        slotLabel: e.bellSlot.label,
        subjectId: e.subjectId,
        subjectName: e.subject.name,
        teachers: e.teachers.map((x) => ({
          id: x.teacher.id,
          name: `${x.teacher.firstName} ${x.teacher.lastName}`,
          isActive: x.teacher.isActive,
        })),
      })),
    };
  }

  /**
   * The shared core of fork and copy. Collects EVERY problem (§18.4 rule 2):
   * lessons already at the destination, teachers without an effective
   * assignment there, an acknowledgement that does not match, and — when the
   * destination is empty, so the lessons can actually be written — the clashes
   * the copy would add. The caller decides: preview → roll back and report;
   * problems → refuse and roll back; none → commit.
   */
  private async copyLessons(
    db: TenantDb,
    clashes: ClashGuard,
    authCtx: AuthContext,
    source: CopySource,
    dest: { academicYearId: string; termId: string | null },
    opts: { leaveOff: boolean; acknowledged: TeacherRemovalDto[] },
  ): Promise<CopyOutcome> {
    const schoolId = authCtx.schoolId;
    const existing = await db.timetable.findFirst({
      where: { schoolId, classArmId: source.classArmId, academicYearId: dest.academicYearId, termId: dest.termId },
      select: { id: true, classArmId: true, academicYearId: true, termId: true, _count: { select: { entries: true } } },
    });
    const destinationLessonCount = existing?._count.entries ?? 0;

    // D33 at the destination, for every (subject, teacher) pair at once.
    const coverage = await this.assignmentCoverage(db, schoolId, { classArmId: source.classArmId, ...dest }, source.entries);
    const unassigned: UnassignedTeacherDto[] = [];
    const warnings = new Map<string, AssignmentWarningDto>();
    for (const e of source.entries) {
      for (const t of e.teachers) {
        const c = coverage.get(`${e.subjectId}|${t.id}`)!;
        if (!t.isActive || c.covered.length === 0) {
          unassigned.push({ dayOfWeek: e.dayOfWeek, bellSlotId: e.bellSlotId, slotLabel: e.slotLabel, teacherId: t.id, teacherName: t.name, subjectName: e.subjectName });
        } else if (c.covered.length < c.inForce.length && !warnings.has(t.id)) {
          warnings.set(t.id, {
            teacherId: t.id,
            teacherName: t.name,
            uncoveredTermNames: c.inForce.filter((x) => !c.covered.includes(x.id)).map((x) => x.name),
          });
        }
      }
    }

    // Q42 — leaving teachers off is accepted only against EXACTLY the list the
    // server computes now. A stale confirmation is refused, never widened.
    const removalKey = (r: { dayOfWeek: number; bellSlotId: string; teacherId: string }) => `${r.dayOfWeek}|${r.bellSlotId}|${r.teacherId}`;
    const serverKeys = new Set(unassigned.map(removalKey));
    const ackKeys = new Set(opts.acknowledged.map(removalKey));
    const ackMatches = serverKeys.size === ackKeys.size && [...serverKeys].every((k) => ackKeys.has(k));
    const acknowledgementMismatch = opts.leaveOff && !ackMatches;
    const removing = opts.leaveOff && ackMatches ? serverKeys : new Set<string>();

    const blockedBeforeWrite =
      destinationLessonCount > 0 || acknowledgementMismatch || (unassigned.length > 0 && removing.size === 0);

    let header: TimetableHeaderDto | null = existing
      ? { id: existing.id, classArmId: existing.classArmId, academicYearId: existing.academicYearId, termId: existing.termId }
      : null;
    let added: TimetableClashDto[] = [];
    let lessons: LessonDto[] = [];
    const clashesChecked = destinationLessonCount === 0;

    if (clashesChecked) {
      await clashes.begin(dest.academicYearId);
      if (!header) {
        header = await db.timetable.create({
          data: { schoolId, classArmId: source.classArmId, academicYearId: dest.academicYearId, termId: dest.termId, createdBy: authCtx.userId },
          select: { id: true, classArmId: true, academicYearId: true, termId: true },
        });
      }
      for (const e of source.entries) {
        const entry = await db.timetableEntry.create({
          data: { schoolId, timetableId: header.id, dayOfWeek: e.dayOfWeek, bellSlotId: e.bellSlotId, subjectId: e.subjectId, updatedBy: authCtx.userId },
          select: { id: true },
        });
        const teacherIds = e.teachers
          .filter((t) => !removing.has(removalKey({ dayOfWeek: e.dayOfWeek, bellSlotId: e.bellSlotId, teacherId: t.id })))
          .map((t) => t.id);
        if (teacherIds.length > 0) {
          await db.timetableEntryTeacher.createMany({ data: teacherIds.map((teacherId) => ({ schoolId, entryId: entry.id, teacherId })) });
        }
      }
      added = await clashes.added();
      lessons = await this.loadLessons(db, schoolId, header.id);
    }

    const ok = !blockedBeforeWrite && added.length === 0;
    return {
      sourceId: source.id,
      className: source.className,
      result: {
        preview: false,
        ok,
        timetable: ok ? header : null,
        lessonsCopied: ok ? source.entries.length : 0,
        removedTeachers: removing.size > 0 ? unassigned : [],
        assignmentWarnings: [...warnings.values()],
        lessons,
        problems: {
          destinationLessonCount,
          unassignedTeachers: removing.size > 0 ? [] : unassigned,
          clashes: added,
          clashesChecked,
          acknowledgementMismatch,
        },
      },
    };
  }

  /** D33 coverage for many (subject, teacher) pairs at a destination that may not exist yet. */
  private async assignmentCoverage(
    db: TenantDb,
    schoolId: string,
    dest: { classArmId: string; academicYearId: string; termId: string | null },
    entries: CopySource["entries"],
  ): Promise<Map<string, { covered: string[]; inForce: Array<{ id: string; name: string }> }>> {
    const [yearTerms, overrides, assignments] = await Promise.all([
      db.term.findMany({ where: { schoolId, academicYearId: dest.academicYearId }, orderBy: { sequence: "asc" }, select: { id: true, name: true } }),
      dest.termId === null
        ? db.timetable.findMany({
            where: { schoolId, classArmId: dest.classArmId, academicYearId: dest.academicYearId, termId: { not: null } },
            select: { termId: true },
          })
        : Promise.resolve([]),
      db.teacherAssignment.findMany({
        where: { schoolId, classArmId: dest.classArmId, academicYearId: dest.academicYearId, isActive: true },
        select: { teacherId: true, subjectId: true, termId: true },
      }),
    ]);
    const replaced = new Set(overrides.map((o) => o.termId));
    let inForce = dest.termId !== null ? yearTerms.filter((t) => t.id === dest.termId) : yearTerms.filter((t) => !replaced.has(t.id));
    if (inForce.length === 0) inForce = yearTerms;

    const out = new Map<string, { covered: string[]; inForce: Array<{ id: string; name: string }> }>();
    for (const e of entries) {
      for (const t of e.teachers) {
        const key = `${e.subjectId}|${t.id}`;
        if (out.has(key)) continue;
        const mine = assignments.filter((a) => a.teacherId === t.id && a.subjectId === e.subjectId);
        out.set(key, { covered: inForce.filter((x) => mine.some((a) => a.termId === null || a.termId === x.id)).map((x) => x.id), inForce });
      }
    }
    return out;
  }

  // =========================================================================
  // CP4 — publishing (D45)
  // =========================================================================

  async publishTimetable(authCtx: AuthContext, timetableId: string, reqCtx: RequestContext): Promise<PublishResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    return this.runMutation(authCtx, "timetable.publishTimetable", async (db) => {
      const schoolId = authCtx.schoolId;
      const t = await db.timetable.findFirst({
        where: { id: timetableId, schoolId },
        select: {
          id: true,
          classArmId: true,
          academicYearId: true,
          termId: true,
          classArm: { select: { name: true, isActive: true } },
          _count: { select: { entries: true } },
        },
      });
      if (!t || !t.classArm.isActive) throw new NotFoundError("Timetable not found.");
      if (t._count.entries === 0) {
        throw new ValidationError(L.NOTHING_TO_PUBLISH, `${t.classArm.name}'s timetable has no lessons yet.`);
      }

      // The terms THIS timetable is in force right now.
      const yearTerms = await db.term.findMany({
        where: { schoolId, academicYearId: t.academicYearId },
        orderBy: { sequence: "asc" },
        select: { id: true, name: true },
      });
      let terms = yearTerms.filter((x) => x.id === t.termId);
      if (t.termId === null) {
        const overrides = await db.timetable.findMany({
          where: { schoolId, classArmId: t.classArmId, academicYearId: t.academicYearId, termId: { not: null } },
          select: { termId: true },
        });
        const replaced = new Set(overrides.map((o) => o.termId));
        terms = yearTerms.filter((x) => !replaced.has(x.id));
      }
      if (terms.length === 0) {
        throw new ValidationError(
          L.NOTHING_TO_PUBLISH,
          `${t.classArm.name}'s whole-year timetable is replaced by a term timetable in every term, so families would never see it.`,
        );
      }

      // Never show a conflicted timetable as final.
      const termIds = new Set(terms.map((x) => x.id));
      const blocking = (await this.clashFn(db, schoolId, t.academicYearId)).filter(
        (c) => termIds.has(c.termId) && c.classArms.some((a) => a.id === t.classArmId),
      );
      const firstBlock = blocking[0];
      if (firstBlock) {
        throw new ConflictError(
          L.PUBLISH_BLOCKED_BY_CLASH,
          `Resolve this clash before publishing: ${describeClash(firstBlock)}`,
          { clashes: blocking },
        );
      }

      const publishedAt = new Date();
      const hashes: Record<string, string> = {};
      for (const term of terms) {
        const snap = await this.snapshotFn(db, schoolId, t.classArmId, term.id);
        hashes[term.id] = snap.hash;
        await db.timetablePublication.upsert({
          where: { schoolId_classArmId_termId: { schoolId, classArmId: t.classArmId, termId: term.id } },
          create: {
            schoolId,
            classArmId: t.classArmId,
            termId: term.id,
            grid: snap.grid as unknown as Prisma.InputJsonValue,
            contentHash: snap.hash,
            publishedBy: authCtx.userId,
            publishedAt,
          },
          update: {
            grid: snap.grid as unknown as Prisma.InputJsonValue,
            contentHash: snap.hash,
            publishedBy: authCtx.userId,
            publishedAt,
          },
        });
      }

      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.publish,
          entityType: "timetable",
          entityId: t.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { classArmId: t.classArmId, termIds: terms.map((x) => x.id), contentHashes: hashes },
        },
      });
      return { terms, publishedAt: publishedAt.toISOString() };
    });
  }

  /** Withdraw DELETES the publication: nothing remains for a reader to show by mistake. Idempotent. */
  async withdrawPublication(authCtx: AuthContext, input: WithdrawPublicationInput, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, TIMETABLE_MANAGER_ROLES);
    await this.runMutation(authCtx, "timetable.withdrawPublication", async (db) => {
      const schoolId = authCtx.schoolId;
      const existing = await db.timetablePublication.findUnique({
        where: { schoolId_classArmId_termId: { schoolId, classArmId: input.classArmId, termId: input.termId } },
        select: { id: true, contentHash: true, publishedAt: true },
      });
      if (!existing) return;
      await this.withdrawFn(db, existing.id);
      await db.auditLog.create({
        data: {
          schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "timetable_publication",
          entityId: existing.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classArmId: input.classArmId,
            termId: input.termId,
            contentHash: existing.contentHash,
            publishedAt: existing.publishedAt.toISOString(),
          },
        },
      });
    });
  }

  private async publicationStatus(db: TenantDb, schoolId: string, classArmId: string, termId: string): Promise<PublicationStatusDto> {
    const pub = await db.timetablePublication.findUnique({
      where: { schoolId_classArmId_termId: { schoolId, classArmId, termId } },
      select: { contentHash: true, publishedAt: true },
    });
    if (!pub) return { state: "NOT_PUBLISHED", publishedAt: null };
    const live = await this.snapshotFn(db, schoolId, classArmId, termId);
    return {
      state: live.hash === pub.contentHash ? "UP_TO_DATE" : "UNPUBLISHED_CHANGES",
      publishedAt: pub.publishedAt.toISOString(),
    };
  }
}
