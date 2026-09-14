import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, type FamilyTimetableDto, type PublishedGridDto } from "@school-kit/types";

import type { TenantDb } from "./timetable-clash.js";

// Phase 8 / CP4 — THE family-facing read of a timetable (docs/modules/phase-8.md
// §18 D39, D45).
//
// Students (StudentAuthGuard, apps/mobile) and guardians (GuardianAuthGuard,
// apps/portal and apps/mobile) read a class timetable through this class and
// nowhere else — the released-results reader's reasoning (Phase 6 D28): one
// function makes "families see only what was published" structural rather than
// a convention two controllers happen to share.
//
// WHAT IT MAY READ: students, enrollments, terms, class_arms, student_guardians,
// and timetable_publications. NEVER timetables, timetable_entries,
// timetable_entry_teachers or bell_slots — the live timetable. A family cannot
// see a half-built grid, an unresolved clash or an unpublished edit because this
// code has no way to reach one. timetable-family-reader.spec.ts records every
// table this class touches and fails if a live timetable table appears.
//
// Withdraw DELETES the publication row, so there is no "withdrawn" flag here to
// forget to respect.
//
// Family separation is NOT RLS (Phase 6 D27): within one school RLS lets any
// guardian's transaction see any student. The guardian path proves the link
// explicitly, with distinct errors — no such student is 404, not your child is
// 403 — before reading anything about the child.

const NONE = (state: FamilyTimetableDto["state"]): FamilyTimetableDto => ({
  state,
  className: null,
  termName: null,
  publishedAt: null,
  grid: null,
});

@Injectable()
export class TimetableFamilyReader {
  /** Student read — the student is the session's student; the request names no id. */
  async forStudent(schoolId: string, studentId: string): Promise<FamilyTimetableDto> {
    return withTenant(schoolId, (db) => this.classWeek(db, schoolId, studentId));
  }

  /** Guardian read — explicit link check first (404 no student, 403 not linked). */
  async forGuardian(schoolId: string, guardianId: string, studentId: string): Promise<FamilyTimetableDto> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.findFirst({ where: { id: studentId, schoolId }, select: { id: true } });
      if (!student) throw new NotFoundError("Student not found.");
      const link = await db.studentGuardian.findFirst({ where: { studentId, guardianId }, select: { id: true } });
      if (!link) throw new ForbiddenError("NOT_LINKED_TO_STUDENT", "You do not have access to this student.");
      return this.classWeek(db, schoolId, studentId);
    });
  }

  /**
   * The child's class timetable for the CURRENT term, as PUBLISHED. Takes the
   * tenant handle so the spec can exercise it with a recording proxy.
   */
  async classWeek(db: TenantDb, schoolId: string, studentId: string): Promise<FamilyTimetableDto> {
    const term = await db.term.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true } });
    if (!term) return NONE("NO_CURRENT_TERM");

    // ENROLLED only (§18.4 rule 5): a withdrawn, graduated or unenrolled child
    // sees an empty state, never the last class they were in.
    const enrollment = await db.enrollment.findFirst({
      where: { schoolId, studentId, termId: term.id, status: "ENROLLED" },
      select: { classArm: { select: { id: true, name: true, isActive: true } } },
    });
    if (!enrollment) return { ...NONE("NOT_ENROLLED"), termName: term.name };

    const base = { className: enrollment.classArm.name, termName: term.name };
    // D44: a deactivated class has no timetable surface.
    if (!enrollment.classArm.isActive) return { ...NONE("NOT_PUBLISHED"), ...base };

    const publication = await db.timetablePublication.findUnique({
      where: { schoolId_classArmId_termId: { schoolId, classArmId: enrollment.classArm.id, termId: term.id } },
      select: { grid: true, publishedAt: true },
    });
    if (!publication) return { ...NONE("NOT_PUBLISHED"), ...base };

    return {
      state: "PUBLISHED",
      ...base,
      publishedAt: publication.publishedAt.toISOString(),
      grid: publication.grid as unknown as PublishedGridDto,
    };
  }
}
