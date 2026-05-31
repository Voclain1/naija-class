import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateTeacherAssignmentInput,
  type ListTeacherAssignmentsQuery,
  type TeacherAssignmentDto,
  type TeacherAssignmentListResponse,
  type UpdateTeacherAssignmentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  create: "teacher-assignment.create",
  update: "teacher-assignment.update",
  delete: "teacher-assignment.delete",
} as const;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Injectable()
export class TeacherAssignmentsService {
  // ----------------------------------------------------------------------
  // list — admin-only, cursor-paginated by id ASC, filterable.
  //
  // This is the ADMIN list (the staff-detail "who teaches what" view and the
  // arm-detail "who teaches here" view). The teacher's OWN scoped view is a
  // separate dedicated endpoint that lands in cp2 — this endpoint is gated
  // owner|admin and never branches on teacher scope.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    query: ListTeacherAssignmentsQuery,
  ): Promise<TeacherAssignmentListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.TeacherAssignmentWhereInput = {};
      if (query.teacherId) where.teacherId = query.teacherId;
      if (query.classArmId) where.classArmId = query.classArmId;
      if (query.academicYearId) where.academicYearId = query.academicYearId;
      if (query.subjectId) where.subjectId = query.subjectId;
      if (query.isActive !== undefined) where.isActive = query.isActive;
      if (query.cursor) where.id = { gt: query.cursor };

      const rows = await db.teacherAssignment.findMany({
        where,
        select: TEACHER_ASSIGNMENT_SELECT,
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const cursor = hasNext ? page[page.length - 1].id : undefined;

      return {
        data: page.map(toTeacherAssignmentDto),
        meta: cursor === undefined ? {} : { cursor },
      };
    });
  }

  // ----------------------------------------------------------------------
  // findById — admin-only.
  // ----------------------------------------------------------------------
  async findById(
    authCtx: AuthContext,
    id: string,
  ): Promise<TeacherAssignmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.teacherAssignment.findUnique({
        where: { id },
        select: TEACHER_ASSIGNMENT_SELECT,
      });
      if (!row) throw new NotFoundError("Teacher assignment not found.");
      return toTeacherAssignmentDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create — admin assigns a teacher to teach a subject in an arm.
  //
  // Validation (all in this tenant — RLS would return null on a foreign id,
  // but an explicit NotFound/Validation tells the admin what went wrong
  // instead of a raw FK error):
  //   - teacher exists, is active, and holds the `teacher` role
  //   - class arm exists (and is active — can't assign into a dead arm)
  //   - subject exists (and is active)
  //   - academic year exists
  //   - if termId set: term exists AND belongs to academicYearId
  //
  // Duplicate guard: the DB unique (schoolId, teacherId, classArmId,
  // subjectId, academicYearId, termId) blocks the same teacher on an
  // identical NON-null-term tuple, but Postgres treats NULL term as DISTINCT
  // — so two identical whole-year rows would NOT collide. We therefore
  // pre-check for an existing identical ACTIVE assignment (matching null term
  // explicitly) and return 409 TEACHER_ALREADY_ASSIGNED; the P2002 catch is
  // the backstop for the non-null race. Co-teaching (a DIFFERENT teacher on
  // the same arm+subject+year+term) is intentionally allowed.
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateTeacherAssignmentInput,
    reqCtx: RequestContext,
  ): Promise<TeacherAssignmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const termId = input.termId ?? null;

    return withTenant(authCtx.schoolId, async (db) => {
      await assertUserIsTeacher(db, input.teacherId);

      const arm = await db.classArm.findUnique({
        where: { id: input.classArmId },
        select: { id: true, isActive: true },
      });
      if (!arm) throw new NotFoundError("Class arm not found.");
      if (!arm.isActive) {
        throw new ValidationError(
          "INACTIVE_CLASS_ARM",
          "Cannot assign a teacher to an inactive class arm.",
        );
      }

      const subject = await db.subject.findUnique({
        where: { id: input.subjectId },
        select: { id: true, isActive: true },
      });
      if (!subject) throw new NotFoundError("Subject not found.");
      if (!subject.isActive) {
        throw new ValidationError(
          "INACTIVE_SUBJECT",
          "Cannot assign a teacher to an inactive subject.",
        );
      }

      const year = await db.academicYear.findUnique({
        where: { id: input.academicYearId },
        select: { id: true },
      });
      if (!year) throw new NotFoundError("Academic year not found.");

      if (termId !== null) {
        const term = await db.term.findUnique({
          where: { id: termId },
          select: { id: true, academicYearId: true },
        });
        if (!term) throw new NotFoundError("Term not found.");
        if (term.academicYearId !== input.academicYearId) {
          throw new ValidationError(
            "TERM_YEAR_MISMATCH",
            "The term does not belong to the given academic year.",
          );
        }
      }

      // Pre-check the duplicate case (covers the NULL-term gap the DB unique
      // misses). Scoped to active rows — a deactivated assignment shouldn't
      // block re-assigning the same teacher.
      const duplicate = await db.teacherAssignment.findFirst({
        where: {
          teacherId: input.teacherId,
          classArmId: input.classArmId,
          subjectId: input.subjectId,
          academicYearId: input.academicYearId,
          termId,
          isActive: true,
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictError(
          "TEACHER_ALREADY_ASSIGNED",
          "This teacher is already assigned to teach this subject in this arm for the selected period.",
        );
      }

      try {
        const created = await db.teacherAssignment.create({
          data: {
            schoolId: authCtx.schoolId,
            teacherId: input.teacherId,
            classArmId: input.classArmId,
            subjectId: input.subjectId,
            academicYearId: input.academicYearId,
            termId,
          },
          select: TEACHER_ASSIGNMENT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "teacher_assignment",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            // PII-free: ids only.
            metadata: {
              teacherId: created.teacherId,
              classArmId: created.classArmId,
              subjectId: created.subjectId,
              academicYearId: created.academicYearId,
              termId: created.termId,
            },
          },
        });

        return toTeacherAssignmentDto(created);
      } catch (e) {
        throw mapTeacherAssignmentUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update — toggle isActive (the only mutable field). Deactivating is the
  // soft-unassign path: the row stays for history, and the cp2 scope filter
  // only counts active assignments.
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateTeacherAssignmentInput,
    reqCtx: RequestContext,
  ): Promise<TeacherAssignmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.teacherAssignment.findUnique({
        where: { id },
        select: { id: true, isActive: true },
      });
      if (!existing) throw new NotFoundError("Teacher assignment not found.");

      const data: Prisma.TeacherAssignmentUpdateInput = {};
      if (input.isActive !== undefined) data.isActive = input.isActive;

      const updated = await db.teacherAssignment.update({
        where: { id },
        data,
        select: TEACHER_ASSIGNMENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "teacher_assignment",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            previousIsActive: existing.isActive,
            changed: Object.keys(data),
          },
        },
      });

      return toTeacherAssignmentDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // delete — hard delete. History lives in audit_logs (phase-1.md:697).
  // Accepts owner|admin for now; slice 13 may tighten via PermissionsGuard.
  // ----------------------------------------------------------------------
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.teacherAssignment.findUnique({
        where: { id },
        select: {
          id: true,
          teacherId: true,
          classArmId: true,
          subjectId: true,
          academicYearId: true,
          termId: true,
        },
      });
      if (!existing) throw new NotFoundError("Teacher assignment not found.");

      await db.teacherAssignment.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "teacher_assignment",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            teacherId: existing.teacherId,
            classArmId: existing.classArmId,
            subjectId: existing.subjectId,
            academicYearId: existing.academicYearId,
            termId: existing.termId,
          },
        },
      });
    });
  }
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

const TEACHER_ASSIGNMENT_SELECT = {
  id: true,
  teacherId: true,
  classArmId: true,
  subjectId: true,
  academicYearId: true,
  termId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TeacherAssignmentSelect;

type TeacherAssignmentRow = Prisma.TeacherAssignmentGetPayload<{
  select: typeof TEACHER_ASSIGNMENT_SELECT;
}>;

function toTeacherAssignmentDto(
  row: TeacherAssignmentRow,
): TeacherAssignmentDto {
  return {
    id: row.id,
    teacherId: row.teacherId,
    classArmId: row.classArmId,
    subjectId: row.subjectId,
    academicYearId: row.academicYearId,
    termId: row.termId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// teacher_assignments has one unique-per-school constraint: (school_id,
// teacher_id, class_arm_id, subject_id, academic_year_id, term_id). Any
// P2002 from create is the same teacher on an identical non-null-term tuple
// (the null-term case is caught earlier by the service pre-check). The
// RLS-hides-constraint-name quirk means we don't get the target field back;
// this is the only unique on the table so the discriminator is unambiguous.
function mapTeacherAssignmentUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "TEACHER_ALREADY_ASSIGNED",
      "This teacher is already assigned to teach this subject in this arm for the selected period.",
    );
  }
  return e;
}

// Teacher validation — the user must (a) exist in this tenant, (b) be active,
// and (c) hold the `teacher` role. Mirrors the slice-3 assertUserIsTeacher on
// ClassArm.classTeacherId: (a) is enforced by RLS (a foreign user returns
// null), (b)+(c) are application-level authorization. We match
// `role.key === "teacher"` regardless of role scope (system or school-scoped)
// — the system `teacher` role is seeded (slice 10) and pilots may add their
// own school-scoped one before the slice-13 rollup.
async function assertUserIsTeacher(
  db: PrismaClient,
  userId: string,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user) {
    throw new ValidationError(
      "teacherId references a user that does not exist in this school.",
      {
        issues: [
          { path: "teacherId", code: "not_found", message: "user not found" },
        ],
      },
    );
  }
  if (!user.isActive) {
    throw new ValidationError("teacherId references an inactive user.", {
      issues: [
        { path: "teacherId", code: "inactive", message: "user is inactive" },
      ],
    });
  }
  const grant = await db.userRole.findFirst({
    where: { userId, role: { key: "teacher" } },
    select: { userId: true },
  });
  if (!grant) {
    throw new ValidationError("teacherId user does not have the teacher role.", {
      issues: [
        {
          path: "teacherId",
          code: "not_a_teacher",
          message: "user is not a teacher",
        },
      ],
    });
  }
}
