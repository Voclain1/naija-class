import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { NotFoundError, type LessonDto, type TeacherTimetableDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import type { TenantDb } from "./timetable-clash.js";

// Phase 8 / CP4 — a teacher's own timetable (docs/modules/phase-8.md §18 D37, Q38).
//
// Two sections, and nothing else:
//   * ownLessons  — every lesson the caller teaches, in the timetable IN FORCE for
//                   the chosen term, across ACTIVE classes (D44);
//   * formClasses — read-only, the full in-force grid of each ACTIVE class the
//                   caller is FORM TEACHER of (ClassArm.classTeacherId). A class
//                   the teacher merely teaches a subject in is NOT included.
// No other class's grid, and no other teacher's week.
//
// Teachers read the LIVE timetable, not the published snapshot (D45): they are
// staff and follow what is actually in force.
//
// Teacher role only, asserted here like every /teacher-scope route: owner/admin
// use the builder.

type InForce = Map<string, string>; // classArmId -> timetableId in force for the term

@Injectable()
export class TimetableTeacherReader {
  async getMyTimetable(authCtx: AuthContext, termId: string | undefined): Promise<TeacherTimetableDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["teacher"]);
    const schoolId = authCtx.schoolId;

    return withTenant(schoolId, async (db) => {
      const term = termId
        ? await db.term.findFirst({ where: { id: termId, schoolId }, select: { id: true, name: true, academicYearId: true } })
        : await db.term.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true, academicYearId: true } });
      if (termId && !term) throw new NotFoundError("Term not found.");

      const [slots, school] = await Promise.all([
        db.bellSlot.findMany({
          where: { schoolId },
          orderBy: { position: "asc" },
          select: { id: true, position: true, label: true, kind: true, startMinute: true, endMinute: true },
        }),
        db.school.findUnique({ where: { id: schoolId }, select: { schoolWeekDays: true } }),
      ]);
      const schoolWeekDays = [...(school?.schoolWeekDays ?? [])].sort((a, b) => a - b);
      if (!term) {
        return { term: null, terms: [], slots, schoolWeekDays, ownLessons: [], formClasses: [] };
      }

      const [terms, inForce] = await Promise.all([
        db.term.findMany({
          where: { schoolId, academicYearId: term.academicYearId },
          orderBy: { sequence: "asc" },
          select: { id: true, name: true, isCurrent: true },
        }),
        this.inForceByClass(db, schoolId, term.academicYearId, term.id),
      ]);
      const slotById = new Map(slots.map((s) => [s.id, s]));

      const mine = await db.timetableEntry.findMany({
        where: { schoolId, timetableId: { in: [...inForce.values()] }, teachers: { some: { teacherId: authCtx.userId } } },
        select: {
          dayOfWeek: true,
          bellSlotId: true,
          subject: { select: { name: true } },
          timetable: { select: { classArm: { select: { id: true, name: true } } } },
          teachers: { select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
        },
      });
      const ownLessons = mine
        .map((e) => {
          const s = slotById.get(e.bellSlotId)!;
          return {
            dayOfWeek: e.dayOfWeek,
            slot: { position: s.position, label: s.label, startMinute: s.startMinute, endMinute: s.endMinute },
            classArmId: e.timetable.classArm.id,
            className: e.timetable.classArm.name,
            subjectName: e.subject.name,
            coTeacherNames: e.teachers
              .filter((t) => t.teacher.id !== authCtx.userId)
              .map((t) => `${t.teacher.firstName} ${t.teacher.lastName}`)
              .sort(),
          };
        })
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.slot.position - b.slot.position);

      // Q38 — the classes this teacher is FORM teacher of, and only those.
      const formArms = await this.formTeacherArms(db, schoolId, authCtx.userId);
      const formClasses: TeacherTimetableDto["formClasses"] = [];
      for (const arm of formArms) {
        const timetableId = inForce.get(arm.id);
        formClasses.push({
          classArmId: arm.id,
          className: arm.name,
          lessons: timetableId ? await this.lessonsOf(db, schoolId, timetableId) : [],
        });
      }

      return { term: { id: term.id, name: term.name }, terms, slots, schoolWeekDays, ownLessons, formClasses };
    });
  }

  /** Test seam (Q38 mutation): which classes count as the teacher's form classes. */
  formTeacherArms = (db: TenantDb, schoolId: string, userId: string) =>
    db.classArm.findMany({
      where: { schoolId, classTeacherId: userId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

  /** Each ACTIVE class's timetable in force for the term: its override, else its year-wide one. */
  private async inForceByClass(db: TenantDb, schoolId: string, academicYearId: string, termId: string): Promise<InForce> {
    const headers = await db.timetable.findMany({
      where: { schoolId, academicYearId, OR: [{ termId }, { termId: null }], classArm: { isActive: true } },
      select: { id: true, classArmId: true, termId: true },
    });
    const out: InForce = new Map();
    // Year-wide first, then term overrides replace them (D13).
    for (const h of headers) if (h.termId === null) out.set(h.classArmId, h.id);
    for (const h of headers) if (h.termId === termId) out.set(h.classArmId, h.id);
    return out;
  }

  private async lessonsOf(db: TenantDb, schoolId: string, timetableId: string): Promise<LessonDto[]> {
    const rows = await db.timetableEntry.findMany({
      where: { schoolId, timetableId },
      orderBy: [{ dayOfWeek: "asc" }, { bellSlot: { position: "asc" } }],
      select: {
        id: true,
        dayOfWeek: true,
        bellSlotId: true,
        subjectId: true,
        subject: { select: { name: true } },
        teachers: { select: { teacher: { select: { id: true, firstName: true, lastName: true } } } },
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
}
