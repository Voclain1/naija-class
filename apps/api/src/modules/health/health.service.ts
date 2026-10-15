import { Injectable } from "@nestjs/common";

import { withGuardian, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  HEALTH_PROFILE_FIELDS,
  type HealthProfileDto,
  type HealthProfileFieldsDto,
  type HealthStudentListQuery,
  type HealthStudentListResponse,
  type PortalHealthProfileDto,
  type TeacherHealthNoteForStudentDto,
  type TeacherHealthNotesResponse,
  type UpdateHealthProfileInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { assertTeachesStudent } from "../behaviour/teaches-student.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// Phase 9 / CP3.1 — health profiles (docs/modules/phase-9.md §10).
//
//   - owner, admin and the Health officer read and keep the whole profile;
//   - a teacher of the child reads the "For teachers" note and nothing else;
//   - the child's guardians read the whole profile, read-only;
//   - the student's own portal has no route.
//
// Every read is audited, including the teacher's and the parent's, and the
// health text never goes into the audit log: field NAMES and counts only.
// No AI anywhere near it.

const AUDIT = {
  read: "health.read",
  update: "health.update",
  noteRead: "health.note.read",
  portalRead: "health.portal.read",
} as const;

const RECORD_ROLES = ["owner", "admin", "health_officer"];
const NOTE_TEACH_MESSAGE = "You can only see this for a student you teach.";

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

const fullName = (s: { firstName: string; lastName: string }): string => `${s.firstName} ${s.lastName}`;

const EMPTY_FIELDS: HealthProfileFieldsDto = {
  allergies: null,
  conditions: null,
  medication: null,
  gpClinic: null,
  emergencyNotes: null,
  bloodGroup: null,
  teacherNote: null,
};

function fieldsOf(row: HealthProfileFieldsDto | null): HealthProfileFieldsDto {
  if (!row) return { ...EMPTY_FIELDS };
  return {
    allergies: row.allergies,
    conditions: row.conditions,
    medication: row.medication,
    gpClinic: row.gpClinic,
    emergencyNotes: row.emergencyNotes,
    bloodGroup: row.bloodGroup,
    teacherNote: row.teacherNote,
  };
}

@Injectable()
export class HealthService {
  // =========================================================================
  // GET /health/students — the Health page's list: names and flags only
  // =========================================================================
  async listStudents(authCtx: AuthContext, query: HealthStudentListQuery): Promise<HealthStudentListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const arms = await db.classArm.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      const q = query.q?.trim();
      const students = await db.student.findMany({
        where: {
          status: "ACTIVE",
          ...(q
            ? {
                OR: [
                  { firstName: { contains: q, mode: "insensitive" } },
                  { lastName: { contains: q, mode: "insensitive" } },
                  { admissionNumber: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
          ...(query.armId
            ? { enrollments: { some: { classArmId: query.armId, status: "ENROLLED", ...(term ? { termId: term.id } : {}) } } }
            : {}),
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          healthProfile: { select: { teacherNote: true } },
          enrollments: {
            where: { status: "ENROLLED", ...(term ? { termId: term.id } : {}) },
            select: { classArm: { select: { name: true } } },
            take: 1,
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        take: 100,
      });
      return {
        data: students.map((s) => ({
          studentId: s.id,
          name: fullName(s),
          admissionNumber: s.admissionNumber,
          className: s.enrollments[0]?.classArm.name ?? null,
          hasProfile: s.healthProfile !== null,
          hasTeacherNote: !!s.healthProfile?.teacherNote,
        })),
        arms: [...arms].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
      };
    });
  }

  // =========================================================================
  // GET /health/students/:id — the whole profile, audited
  // =========================================================================
  async getProfile(authCtx: AuthContext, studentId: string, reqCtx: RequestContext): Promise<HealthProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const dto = await this.readProfile(db, studentId);
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.read,
          entityType: "health_profile",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId, recorded: dto.updatedAt !== null },
        },
      });
      return dto;
    });
  }

  // =========================================================================
  // PUT /health/students/:id — create or change the profile
  // =========================================================================
  async updateProfile(
    authCtx: AuthContext,
    studentId: string,
    input: UpdateHealthProfileInput,
    reqCtx: RequestContext,
  ): Promise<HealthProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, RECORD_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const student = await db.student.findUnique({ where: { id: studentId }, select: { id: true } });
      if (!student) throw new NotFoundError("That student could not be found.");
      const existing = await db.healthProfile.findUnique({ where: { studentId } });

      // Only the fields actually sent change; undefined leaves one alone.
      const data: Partial<Record<(typeof HEALTH_PROFILE_FIELDS)[number], string | null>> = {};
      for (const field of HEALTH_PROFILE_FIELDS) {
        const value = (input as Record<string, string | null | undefined>)[field];
        if (value === undefined) continue;
        const next = value === "" ? null : value;
        if ((existing?.[field] ?? null) !== next) data[field] = next;
      }
      const changed = Object.keys(data);

      if (changed.length > 0 || !existing) {
        await db.healthProfile.upsert({
          where: { studentId },
          create: { schoolId: authCtx.schoolId, studentId, ...data, updatedBy: authCtx.userId },
          update: { ...data, updatedBy: authCtx.userId },
        });
        // Field NAMES only. The text is special-category health data and has
        // no business in a second place with a different retention.
        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "health_profile",
            entityId: studentId,
            ipAddress: reqCtx.ipAddress,
            metadata: { studentId, changed },
          },
        });
      }
      return this.readProfile(db, studentId);
    });
  }

  // =========================================================================
  // GET /health/teacher-notes?armId= — the notes for one class
  // =========================================================================
  /**
   * The "For teachers" notes of the children in one class, for a teacher of
   * that class (or an owner or admin). Only children with a note are listed,
   * and only the note: nothing else from the record leaves this method.
   */
  async teacherNotesForArm(authCtx: AuthContext, armId: string, reqCtx: RequestContext): Promise<TeacherHealthNotesResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    if (!armId || !/^[0-9a-f-]{36}$/i.test(armId)) throw new ValidationError("Choose a class.");
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      if (!isAdmin) {
        const scope = await getTeacherScope(db as never, authCtx.userId);
        if (!scope.classArms.some((a) => a.id === armId)) throw new NotFoundError("That class could not be found.");
      }
      const term = await db.term.findFirst({ where: { isCurrent: true }, select: { id: true } });
      const rows = await db.healthProfile.findMany({
        where: {
          teacherNote: { not: null },
          student: {
            status: "ACTIVE",
            enrollments: { some: { classArmId: armId, status: "ENROLLED", ...(term ? { termId: term.id } : {}) } },
          },
        },
        select: { studentId: true, teacherNote: true, student: { select: { firstName: true, lastName: true } } },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.noteRead,
          entityType: "class_arm",
          entityId: armId,
          ipAddress: reqCtx.ipAddress,
          metadata: { armId, count: rows.length },
        },
      });
      return {
        data: rows
          .filter((r) => r.teacherNote)
          .map((r) => ({ studentId: r.studentId, name: fullName(r.student), note: r.teacherNote! }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    });
  }

  // =========================================================================
  // GET /health/teacher-notes/students/:id — one child's note
  // =========================================================================
  async teacherNoteForStudent(
    authCtx: AuthContext,
    studentId: string,
    reqCtx: RequestContext,
  ): Promise<TeacherHealthNoteForStudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      if (!isAdmin) await assertTeachesStudent(db, authCtx.userId, studentId, NOTE_TEACH_MESSAGE);
      const row = await db.healthProfile.findUnique({ where: { studentId }, select: { teacherNote: true } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.noteRead,
          entityType: "health_profile",
          entityId: studentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId, shared: !!row?.teacherNote },
        },
      });
      return { studentId, note: row?.teacherNote ?? null };
    });
  }

  // =========================================================================
  // GET /portal/students/:id/health — the parent's read
  // =========================================================================
  async profileForGuardian(guardianCtx: GuardianAuthContext, studentId: string): Promise<PortalHealthProfileDto> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const row = await db2.healthProfile.findUnique({ where: { studentId } });
        await db2.auditLog.create({
          data: {
            schoolId: guardianCtx.schoolId,
            userId: guardianCtx.guardianId,
            action: AUDIT.portalRead,
            entityType: "health_profile",
            entityId: studentId,
            metadata: { studentId, principal: "guardian" },
          },
        });
        return { ...fieldsOf(row), updatedAt: row?.updatedAt ?? null };
      }),
    );
  }

  // =========================================================================

  private async readProfile(db: Db, studentId: string): Promise<HealthProfileDto> {
    const student = await db.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        admissionNumber: true,
        healthProfile: true,
        enrollments: {
          where: { status: "ENROLLED" },
          orderBy: { createdAt: "desc" },
          select: { classArm: { select: { name: true } } },
          take: 1,
        },
      },
    });
    if (!student) throw new NotFoundError("That student could not be found.");
    const profile = student.healthProfile;
    const editor = profile?.updatedBy
      ? await db.user.findUnique({ where: { id: profile.updatedBy }, select: { firstName: true, lastName: true } })
      : null;
    return {
      studentId: student.id,
      studentName: fullName(student),
      admissionNumber: student.admissionNumber,
      className: student.enrollments[0]?.classArm.name ?? null,
      ...fieldsOf(profile),
      updatedByName: editor ? fullName(editor) : null,
      updatedAt: profile?.updatedAt ?? null,
    };
  }

  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }
}

