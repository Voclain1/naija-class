import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type BulkCreateEnrollmentInput,
  type BulkEnrollmentResponse,
  type CreateEnrollmentInput,
  type CurrentEnrollmentRefDto,
  type EnrollmentDto,
  type EnrollmentListResponse,
  type EnrollmentStatusDto,
  type ListEnrollmentsQuery,
  type MoveEnrollmentInput,
  type MoveEnrollmentRecordsDto,
  type MoveEnrollmentResultDto,
  type UpdateEnrollmentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import * as password from "../../common/auth/password";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  create: "enrollment.create",
  update: "enrollment.update",
  delete: "enrollment.delete",
  bulkCreate: "enrollment.bulk-create",
  move: "enrollment.move-class",
} as const;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

@Injectable()
export class EnrollmentsService {
  // ----------------------------------------------------------------------
  // list — cursor-paginated by id ASC, filterable by every relation.
  //
  // Order chosen for stability: id is opaque + monotonic-enough for cursor
  // paging. The roster page sets termId + classArmId and gets one term's
  // arm; the student-detail Enrollments tab sets studentId only.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    query: ListEnrollmentsQuery,
  ): Promise<EnrollmentListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.EnrollmentWhereInput = {};
      if (query.termId) where.termId = query.termId;
      if (query.academicYearId) where.academicYearId = query.academicYearId;
      if (query.classArmId) where.classArmId = query.classArmId;
      if (query.studentId) where.studentId = query.studentId;
      if (query.status) where.status = query.status;
      if (query.cursor) where.id = { gt: query.cursor };

      const rows = await db.enrollment.findMany({
        where,
        select: ENROLLMENT_SELECT,
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const cursor = hasNext ? page[page.length - 1].id : undefined;

      return {
        data: page.map(toEnrollmentDto),
        meta: cursor === undefined ? {} : { cursor },
      };
    });
  }

  // ----------------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<EnrollmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.enrollment.findUnique({
        where: { id },
        select: ENROLLMENT_SELECT,
      });
      if (!row) throw new NotFoundError("Enrollment not found.");
      return toEnrollmentDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create — single enrollment.
  //
  // The server resolves academicYearId from termId — the client never
  // sends academicYearId. This enforces the denormalisation invariant
  // (enrollment.academicYearId = term.academicYearId) at write time so
  // there's no path by which a malicious or buggy caller could create
  // an enrollment with a foreign-year + this-term combo.
  //
  // Term + ClassArm are also verified to exist in this tenant — RLS
  // would naturally return null on a foreign id, but a NotFoundError
  // tells the admin what went wrong instead of letting the FK fire a
  // confusing "Foreign key constraint failed" further down.
  //
  // The (schoolId, studentId, termId) @@unique collision returns 409
  // ENROLLMENT_ALREADY_EXISTS — admin should PATCH the existing row,
  // not try to insert a second.
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateEnrollmentInput,
    reqCtx: RequestContext,
  ): Promise<EnrollmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      // Resolve academicYearId from the term in this tenant.
      const term = await db.term.findUnique({
        where: { id: input.termId },
        select: { id: true, academicYearId: true },
      });
      if (!term) {
        throw new NotFoundError("Term not found.");
      }

      const arm = await db.classArm.findUnique({
        where: { id: input.classArmId },
        select: { id: true, isActive: true },
      });
      if (!arm) throw new NotFoundError("Class arm not found.");
      if (!arm.isActive) {
        throw new ValidationError(
          "INACTIVE_CLASS_ARM",
          "Cannot enroll a student into an inactive class arm.",
        );
      }

      const student = await db.student.findUnique({
        where: { id: input.studentId },
        select: { id: true, status: true },
      });
      if (!student) throw new NotFoundError("Student not found.");

      try {
        const created = await db.enrollment.create({
          data: {
            schoolId: authCtx.schoolId,
            studentId: input.studentId,
            termId: input.termId,
            academicYearId: term.academicYearId,
            classArmId: input.classArmId,
            status: input.status ?? "ENROLLED",
            notes: input.notes ?? null,
          },
          select: ENROLLMENT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "enrollment",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            // PII-free: ids + status only.
            metadata: {
              studentId: created.studentId,
              termId: created.termId,
              classArmId: created.classArmId,
              status: created.status,
            },
          },
        });

        return toEnrollmentDto(created);
      } catch (e) {
        throw mapEnrollmentUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update — partial. classArmId and status are the realistic edits;
  // moving a student between students or terms via PATCH is rejected
  // by the DTO (which omits those fields).
  //
  // When status flips to WITHDRAWN, withdrawnAt is set to "now" if not
  // explicitly provided. When status flips OFF of WITHDRAWN (e.g.
  // back to ENROLLED), withdrawnAt is cleared.
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateEnrollmentInput,
    reqCtx: RequestContext,
  ): Promise<EnrollmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.enrollment.findUnique({
        where: { id },
        select: { id: true, status: true, classArmId: true },
      });
      if (!existing) throw new NotFoundError("Enrollment not found.");

      const data: Prisma.EnrollmentUpdateInput = {};
      if (input.classArmId !== undefined) {
        const arm = await db.classArm.findUnique({
          where: { id: input.classArmId },
          select: { id: true, isActive: true },
        });
        if (!arm) throw new NotFoundError("Class arm not found.");
        if (!arm.isActive) {
          throw new ValidationError(
            "INACTIVE_CLASS_ARM",
            "Cannot move an enrollment to an inactive class arm.",
          );
        }
        // D39: a bare PATCH moves only this row, leaving the child's
        // assessment rows and report card on the OLD class. Once either
        // exists, the change must go through POST /enrollments/:id/move,
        // which carries them across under a password check.
        if (input.classArmId !== existing.classArmId) {
          const full = await db.enrollment.findUniqueOrThrow({
            where: { id },
            select: { studentId: true, termId: true },
          });
          const records = await termRecords(db, full.studentId, full.termId);
          if (records.markCount > 0 || records.assessmentCount > 0 || records.reportCardStatus !== null) {
            throw new ConflictError(
              "ENROLLMENT_HAS_TERM_RECORDS",
              "This student already has marks or a report card this term. Use the move action, which carries them to the new class.",
            );
          }
        }
        data.classArm = { connect: { id: input.classArmId } };
      }
      if (input.status !== undefined) {
        data.status = input.status;
        if (input.status === "WITHDRAWN") {
          data.withdrawnAt = input.withdrawnAt ?? new Date();
        } else if (existing.status === "WITHDRAWN") {
          // Flipping off of WITHDRAWN — clear the timestamp.
          data.withdrawnAt = null;
        }
      } else if (input.withdrawnAt !== undefined) {
        // Explicit withdrawnAt update without status change.
        data.withdrawnAt = input.withdrawnAt;
      }
      if (input.notes !== undefined) data.notes = input.notes;

      const updated = await db.enrollment.update({
        where: { id },
        data,
        select: ENROLLMENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "enrollment",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            previousStatus: existing.status,
            previousArmId: existing.classArmId,
            changed: Object.keys(data),
          },
        },
      });

      return toEnrollmentDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // delete — owner-only: enrollments is history-bearing (see
  // OWNER_ONLY_PERMISSIONS in @school-kit/types). The PermissionsGuard denies
  // admin via the enrollment.delete permission; this service assert agrees as
  // defense-in-depth. Audit row records the deletion.
  // ----------------------------------------------------------------------
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.enrollment.findUnique({
        where: { id },
        select: { id: true, studentId: true, termId: true, classArmId: true },
      });
      if (!existing) throw new NotFoundError("Enrollment not found.");

      await db.enrollment.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "enrollment",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: existing.studentId,
            termId: existing.termId,
            classArmId: existing.classArmId,
          },
        },
      });
    });
  }

  // ----------------------------------------------------------------------
  // move — POST /enrollments/:id/move (D39). Same term, another class.
  //
  // Carries the child's records across in ONE transaction:
  //   - the enrolment row's class;
  //   - their assessment rows' denormalised class_arm_id, with positions
  //     cleared (they belonged to the old class's ranking; the next build or
  //     aggregation pass recomputes both classes);
  //   - their DRAFT report card is deleted — it is a snapshot of the old
  //     class, and a build in the new class makes a fresh one.
  // Entered marks (assessment_scores) are keyed by student, not class, and
  // need no change.
  //
  // Refused: a report card past DRAFT (reopen first — the "all cards in a
  // class share a status" invariant), a non-ENROLLED row, the same class, an
  // inactive or missing class.
  //
  // PASSWORD (maintainer's safeguard, 2026-09-21): when the child has any
  // marks or a report card this term, the caller must re-enter their password.
  // Without it: 409 MOVE_NEEDS_PASSWORD, with what would change in `details`.
  // A wrong one: 403 PASSWORD_INCORRECT — deliberately NOT 401, which clients
  // treat as "session over" and would sign the admin out for a typo.
  //
  // Fees are never touched (money goes through FinanceService). If the move
  // changes class LEVEL and an invoice exists, the result says so.
  // ----------------------------------------------------------------------
  async move(
    authCtx: AuthContext,
    id: string,
    input: MoveEnrollmentInput,
    reqCtx: RequestContext,
  ): Promise<MoveEnrollmentResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.enrollment.findUnique({
        where: { id },
        select: { id: true, studentId: true, termId: true, classArmId: true, status: true },
      });
      if (!existing) throw new NotFoundError("Enrollment not found.");
      if (existing.status !== "ENROLLED") {
        throw new ConflictError(
          "ENROLLMENT_NOT_ACTIVE",
          "Only a student currently enrolled in the class can be moved.",
        );
      }
      if (existing.classArmId === input.classArmId) {
        throw new ValidationError("SAME_CLASS_ARM", "The student is already in that class.");
      }

      const fromArm = await db.classArm.findUnique({
        where: { id: existing.classArmId },
        select: { classLevelId: true },
      });
      const toArm = await db.classArm.findUnique({
        where: { id: input.classArmId },
        select: { id: true, isActive: true, classLevelId: true },
      });
      if (!toArm) throw new NotFoundError("Class arm not found.");
      if (!toArm.isActive) {
        throw new ValidationError("INACTIVE_CLASS_ARM", "Cannot move a student into an inactive class arm.");
      }

      const records = await termRecords(db, existing.studentId, existing.termId);
      if (records.reportCardStatus !== null && records.reportCardStatus !== "DRAFT") {
        throw new ConflictError(
          "REPORT_CARD_IN_PROGRESS",
          "This student's report card is already being reviewed or has been released. Reopen the class before moving them.",
        );
      }

      const hasRecords =
        records.markCount > 0 || records.assessmentCount > 0 || records.reportCardStatus !== null;
      if (hasRecords) {
        if (!input.currentPassword) {
          const details: MoveEnrollmentRecordsDto = {
            markCount: records.markCount,
            hasReportCard: records.reportCardStatus !== null,
          };
          throw new ConflictError(
            "MOVE_NEEDS_PASSWORD",
            "This student already has records this term. Enter your password to move them.",
            details,
          );
        }
        const user = await db.user.findUnique({
          where: { id: authCtx.userId },
          select: { passwordHash: true },
        });
        const ok = user?.passwordHash
          ? await password.verifyPassword(user.passwordHash, input.currentPassword).catch(() => false)
          : false;
        if (!ok) {
          throw new ForbiddenError("PASSWORD_INCORRECT", "That password is not correct. Nothing was changed.");
        }
      }

      const updated = await db.enrollment.update({
        where: { id },
        data: { classArm: { connect: { id: input.classArmId } } },
        select: ENROLLMENT_SELECT,
      });
      const moved = await db.assessment.updateMany({
        where: { studentId: existing.studentId, termId: existing.termId },
        data: {
          classArmId: input.classArmId,
          subjectPosition: null,
          classPosition: null,
          positionsComputedAt: null,
        },
      });
      const discarded = await db.reportCard.deleteMany({
        where: { studentId: existing.studentId, termId: existing.termId, status: "DRAFT" },
      });

      const levelChanged = fromArm?.classLevelId !== toArm.classLevelId;
      const invoice = levelChanged
        ? await db.invoice.findFirst({
            where: { studentId: existing.studentId, termId: existing.termId },
            select: { id: true },
          })
        : null;

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.move,
          entityType: "enrollment",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          // PII-free: ids and counts. passwordConfirmed records that the
          // records-changing path was re-authenticated.
          metadata: {
            studentId: existing.studentId,
            termId: existing.termId,
            fromArmId: existing.classArmId,
            toArmId: input.classArmId,
            assessmentsMoved: moved.count,
            marksCarried: records.markCount,
            reportCardDiscarded: discarded.count > 0,
            passwordConfirmed: hasRecords,
            levelChanged,
          },
        },
      });

      return {
        enrollment: toEnrollmentDto(updated),
        assessmentsMoved: moved.count,
        reportCardDiscarded: discarded.count > 0,
        invoiceNeedsReview: invoice !== null,
      };
    });
  }

  // ----------------------------------------------------------------------
  // bulkCreate — term-roll carry-over.
  //
  // The frontend computes the studentIds via the spec's three-group
  // logic (carried over / withdrew last term / admitted after term 1).
  // The endpoint takes the resulting array and creates one ENROLLED
  // enrollment per student into the target term + arm.
  //
  // Idempotent: createMany with skipDuplicates=true; the (schoolId,
  // studentId, termId) @@unique means re-running the same payload
  // silently skips already-enrolled students. The response splits
  // created vs skipped counts so the UI can render a clear summary.
  //
  // Per-row validation:
  //   - Target term + classArm must exist in this tenant.
  //   - studentIds must exist in this tenant; foreign ids land in the
  //     `errors` array with reason "Student not found", not as a
  //     409 that fails the whole batch.
  //   - Withdrawn students are accepted as input — admins might be
  //     re-enrolling a returning student; the row is created with
  //     status=ENROLLED.
  // ----------------------------------------------------------------------
  async bulkCreate(
    authCtx: AuthContext,
    input: BulkCreateEnrollmentInput,
    reqCtx: RequestContext,
  ): Promise<BulkEnrollmentResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({
        where: { id: input.termId },
        select: { id: true, academicYearId: true },
      });
      if (!term) throw new NotFoundError("Term not found.");

      const arm = await db.classArm.findUnique({
        where: { id: input.classArmId },
        select: { id: true, isActive: true },
      });
      if (!arm) throw new NotFoundError("Class arm not found.");
      if (!arm.isActive) {
        throw new ValidationError(
          "INACTIVE_CLASS_ARM",
          "Cannot enroll students into an inactive class arm.",
        );
      }

      // Resolve which input ids are valid Students in this tenant.
      const uniqueIds = [...new Set(input.studentIds)];
      const students = await db.student.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true },
      });
      const validIds = new Set(students.map((s) => s.id));
      const errors: BulkEnrollmentResponse["errors"] = [];
      const candidates: string[] = [];
      for (const studentId of uniqueIds) {
        if (validIds.has(studentId)) {
          candidates.push(studentId);
        } else {
          errors.push({ studentId, reason: "Student not found." });
        }
      }

      // Identify which candidates are already enrolled in this term —
      // we want a clean "skipped" count, not just "createMany silently
      // dropped them". The (schoolId, studentId, termId) @@unique
      // would skip them anyway, but counting them explicitly gives the
      // UI a clear summary.
      const alreadyEnrolled = await db.enrollment.findMany({
        where: {
          termId: input.termId,
          studentId: { in: candidates },
        },
        select: { studentId: true },
      });
      const alreadyEnrolledIds = new Set(
        alreadyEnrolled.map((e) => e.studentId),
      );
      const toCreate = candidates.filter((id) => !alreadyEnrolledIds.has(id));

      // Single bulk insert with skipDuplicates as a belt — even if a
      // concurrent enrollment landed between our SELECT and INSERT, the
      // @@unique catches it.
      const result = await db.enrollment.createMany({
        data: toCreate.map((studentId) => ({
          schoolId: authCtx.schoolId,
          studentId,
          termId: input.termId,
          academicYearId: term.academicYearId,
          classArmId: input.classArmId,
          status: "ENROLLED" as const,
        })),
        skipDuplicates: true,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.bulkCreate,
          entityType: "enrollment",
          entityId: input.termId, // anchor at the term — there's no single enrollment id for a bulk
          ipAddress: reqCtx.ipAddress,
          metadata: {
            termId: input.termId,
            classArmId: input.classArmId,
            requested: input.studentIds.length,
            created: result.count,
            skipped: alreadyEnrolledIds.size,
            errors: errors.length,
          },
        },
      });

      return {
        created: result.count,
        skipped: alreadyEnrolledIds.size,
        errors,
      };
    });
  }

  // ----------------------------------------------------------------------
  // getCurrentEnrollmentForStudent — used by StudentsService.findById to
  // populate StudentDetailDto.currentEnrollment.
  //
  // Joins through term.isCurrent rather than a date-math comparison. The
  // partial unique index on Term (isCurrent=true) guarantees one row at
  // most, so the findFirst is correct + cheap.
  // ----------------------------------------------------------------------
  async getCurrentEnrollmentForStudent(
    authCtx: AuthContext,
    studentId: string,
  ): Promise<CurrentEnrollmentRefDto | null> {
    return withTenant(authCtx.schoolId, async (db) =>
      loadCurrentEnrollmentForStudent(db, studentId),
    );
  }
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

const ENROLLMENT_SELECT = {
  id: true,
  studentId: true,
  termId: true,
  academicYearId: true,
  classArmId: true,
  status: true,
  enrolledAt: true,
  transferredAt: true,
  withdrawnAt: true,
  promotedFromArmId: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EnrollmentSelect;

type EnrollmentRow = Prisma.EnrollmentGetPayload<{
  select: typeof ENROLLMENT_SELECT;
}>;

function toEnrollmentDto(row: EnrollmentRow): EnrollmentDto {
  return {
    id: row.id,
    studentId: row.studentId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    classArmId: row.classArmId,
    status: row.status as EnrollmentStatusDto,
    enrolledAt: row.enrolledAt,
    transferredAt: row.transferredAt,
    withdrawnAt: row.withdrawnAt,
    promotedFromArmId: row.promotedFromArmId,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// enrollments has one unique-per-school constraint: (school_id,
// student_id, term_id). Any P2002 from create/update is a same-term
// collision. The RLS-hides-constraint-name quirk means we don't get the
// target field name back; this is the only unique on the table so the
// discriminator is unambiguous.
function mapEnrollmentUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "ENROLLMENT_ALREADY_EXISTS",
      "This student is already enrolled in this term. Patch the existing row instead.",
    );
  }
  return e;
}

// Shared by EnrollmentsService.getCurrentEnrollmentForStudent and by
// StudentsService.findById (which calls this via the injected service).
// Module-level export so the students module can import + reuse without
// recreating the join shape.
//
/**
 * Validate and insert ONE enrollment inside a caller-supplied transaction.
 *
 * Extracted so `StudentsService.create` can place a student in a class in the
 * SAME transaction that creates them, rather than making a second call
 * afterwards. That is `student-import-enrollment.md` D6 applied to the
 * single-student path: "a row is all-or-nothing: a student is never created
 * without their enrollment when an arm was specified", because the alternative
 * produces exactly the orphaned-student state this work exists to remove.
 *
 * Deliberately NOT built on `bulkCreate`, despite that endpoint already
 * existing and being well tested. `bulkCreate` returns a partial-success
 * envelope and SKIPS duplicates silently — a documented idempotency contract
 * that is right for a 300-student carry-over and wrong for one student, where
 * "you already enrolled this child this term" is the single most useful thing
 * the form can say. `create`'s throw-on-conflict shape is the one this needs.
 *
 * Takes `db` rather than opening its own transaction, so the caller decides
 * the atomicity boundary. Returns the created row; the caller audits.
 */
export async function insertEnrollmentInTx(
  db: Prisma.TransactionClient | PrismaClient,
  schoolId: string,
  input: { studentId: string; termId: string; classArmId: string },
): Promise<{ id: string; termId: string; classArmId: string; academicYearId: string }> {
  const term = await db.term.findUnique({
    where: { id: input.termId },
    select: { id: true, academicYearId: true },
  });
  if (!term) throw new NotFoundError("Term not found.");

  const arm = await db.classArm.findUnique({
    where: { id: input.classArmId },
    select: { id: true, isActive: true },
  });
  if (!arm) throw new NotFoundError("Class arm not found.");
  if (!arm.isActive) {
    throw new ValidationError(
      "INACTIVE_CLASS_ARM",
      "Cannot enroll a student into an inactive class arm.",
    );
  }

  try {
    const created = await db.enrollment.create({
      data: {
        schoolId,
        studentId: input.studentId,
        termId: input.termId,
        // Derived from the term, never accepted from input — the schema
        // comment requires the two stay consistent.
        academicYearId: term.academicYearId,
        classArmId: input.classArmId,
        status: "ENROLLED",
      },
      select: { id: true, termId: true, classArmId: true, academicYearId: true },
    });
    return created;
  } catch (e) {
    throw mapEnrollmentUniqueViolation(e);
  }
}

// Returns CurrentEnrollmentRefDto null-safely. Used in EXACTLY two
// places — see also loadCurrentEnrollmentsForStudents below which does
// the batched form for the roster page.
export async function loadCurrentEnrollmentForStudent(
  db: PrismaClient,
  studentId: string,
): Promise<CurrentEnrollmentRefDto | null> {
  const row = await db.enrollment.findFirst({
    where: { studentId, term: { isCurrent: true } },
    select: {
      id: true,
      status: true,
      academicYearId: true,
      classArm: {
        select: {
          id: true,
          name: true,
          classLevel: { select: { id: true, name: true } },
        },
      },
      term: { select: { id: true, name: true, sequence: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    status: row.status as EnrollmentStatusDto,
    academicYearId: row.academicYearId,
    classArm: {
      id: row.classArm.id,
      name: row.classArm.name,
      classLevel: {
        id: row.classArm.classLevel.id,
        name: row.classArm.classLevel.name,
      },
    },
    term: {
      id: row.term.id,
      name: row.term.name,
      sequence: row.term.sequence,
    },
  };
}

// ----------------------------------------------------------------------
// loadCurrentEnrollmentsForStudents — the batched roster query.
//
// Called once per StudentsService.list call to populate currentEnrollment
// for every student on the page. ONE Prisma query, joins through term
// (isCurrent=true) + classArm + classLevel. Returns a Map studentId ->
// CurrentEnrollmentRefDto so the caller can attach without N+1.
//
// This is what the slice-9 cp1 "no N+1" test asserts on.
// ----------------------------------------------------------------------
export async function loadCurrentEnrollmentsForStudents(
  db: PrismaClient,
  studentIds: string[],
): Promise<Map<string, CurrentEnrollmentRefDto>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.enrollment.findMany({
    where: {
      studentId: { in: studentIds },
      term: { isCurrent: true },
    },
    select: {
      id: true,
      studentId: true,
      status: true,
      academicYearId: true,
      classArm: {
        select: {
          id: true,
          name: true,
          classLevel: { select: { id: true, name: true } },
        },
      },
      term: { select: { id: true, name: true, sequence: true } },
    },
  });
  const map = new Map<string, CurrentEnrollmentRefDto>();
  for (const row of rows) {
    map.set(row.studentId, {
      id: row.id,
      status: row.status as EnrollmentStatusDto,
      academicYearId: row.academicYearId,
      classArm: {
        id: row.classArm.id,
        name: row.classArm.name,
        classLevel: {
          id: row.classArm.classLevel.id,
          name: row.classArm.classLevel.name,
        },
      },
      term: {
        id: row.term.id,
        name: row.term.name,
        sequence: row.term.sequence,
      },
    });
  }
  return map;
}

// What a child already has in a term, for D39's move rules.
async function termRecords(
  db: PrismaClient,
  studentId: string,
  termId: string,
): Promise<{ markCount: number; assessmentCount: number; reportCardStatus: string | null }> {
  const markCount = await db.assessmentScore.count({ where: { studentId, termId } });
  const assessmentCount = await db.assessment.count({ where: { studentId, termId } });
  const card = await db.reportCard.findFirst({ where: { studentId, termId }, select: { status: true } });
  return { markCount, assessmentCount, reportCardStatus: card?.status ?? null };
}
