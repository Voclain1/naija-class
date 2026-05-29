import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreateStudentInput,
  type GraduateStudentInput,
  type ListStudentsQuery,
  type ReactivateStudentInput,
  type StudentDetailDto,
  type StudentDto,
  type StudentListResponse,
  type UpdateStudentInput,
  type WithdrawStudentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import {
  loadCurrentEnrollmentForStudent,
  loadCurrentEnrollmentsForStudents,
} from "../enrollments/enrollments.service";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  create: "student.create",
  update: "student.update",
  withdraw: "student.withdraw",
  graduate: "student.graduate",
  reactivate: "student.reactivate",
} as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class StudentsService {
  // ----------------------------------------------------------------------
  // list — cursor-paginated, id ASC.
  //
  // Cursor is on `id` (UUID) rather than (lastName, firstName, id) because
  // status changes do not move ids — a student withdrawn between page-1
  // and page-2 is still on the next page in the same position. Spec
  // accepts the cosmetic trade-off (alphabetical paging would require a
  // composite cursor; out of scope for cp2).
  //
  // Slice 9: `classArmId` is now a real filter (joins through Enrollment
  // to the student's CURRENT-term enrollment); `academicYearId` stays
  // accepted-but-unused until a more nuanced "ever-enrolled-in-year"
  // filter is requested. The current-arm column is populated by ONE
  // batched query (loadCurrentEnrollmentsForStudents) — see the slice-9
  // cp1 "no N+1" spec.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    query: ListStudentsQuery,
  ): Promise<StudentListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.StudentWhereInput = {};
      if (query.status) where.status = query.status;
      if (query.cursor) where.id = { gt: query.cursor };
      if (query.search) {
        const s = query.search.trim();
        where.OR = [
          { admissionNumber: { contains: s, mode: "insensitive" } },
          { lastName: { contains: s, mode: "insensitive" } },
          { firstName: { contains: s, mode: "insensitive" } },
        ];
      }
      // Slice 9: filter by current-term enrollment's classArmId. Uses
      // the Enrollment relation with `term.isCurrent=true` so the
      // filter restricts to students enrolled in that arm THIS term.
      if (query.classArmId) {
        where.enrollments = {
          some: {
            classArmId: query.classArmId,
            term: { isCurrent: true },
          },
        };
      }

      // Fetch limit + 1 so we know if there's a next page without a count.
      const rows = await db.student.findMany({
        where,
        select: STUDENT_SELECT,
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const cursor = hasNext ? page[page.length - 1].id : undefined;

      // Slice 9: single batched query for current enrollments. ONE
      // round-trip regardless of page size. The slice-9 cp1 spec
      // counts queries to prove this is N+1-free.
      const studentIds = page.map((r) => r.id);
      const currentEnrollments = await loadCurrentEnrollmentsForStudents(
        db,
        studentIds,
      );

      return {
        data: page.map((row) => ({
          ...toStudentDto(row),
          currentEnrollment: currentEnrollments.get(row.id) ?? null,
        })),
        meta: cursor === undefined ? {} : { cursor },
      };
    });
  }

  // ----------------------------------------------------------------------
  // findById — Student detail + linked guardians (populated by slice 5).
  //
  // Returns guardians as StudentGuardianRefDto[] — the "guardian from a
  // student's POV" shape declared in StudentDetailDto. Phone is included
  // because the admin detail view needs it for the "call this guardian"
  // contact card; the redactor masks it before Sentry ships it.
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<StudentDetailDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.student.findUnique({
        where: { id },
        select: {
          ...STUDENT_SELECT,
          guardians: {
            select: {
              id: true,
              isPrimary: true,
              canPickup: true,
              guardian: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  relationship: true,
                  phone: true,
                },
              },
            },
          },
        },
      });
      if (!row) throw new NotFoundError("Student not found.");
      // Slice 9: include currentEnrollment in the detail response.
      // One additional query (the join shape is non-trivial enough that
      // a Prisma `include` on the student.findUnique would also be one
      // round-trip; we use the shared helper for parity with the list path).
      const currentEnrollment = await loadCurrentEnrollmentForStudent(db, id);
      return {
        ...toStudentDto(row),
        currentEnrollment,
        guardians: row.guardians.map((link) => ({
          id: link.guardian.id,
          linkId: link.id,
          firstName: link.guardian.firstName,
          lastName: link.guardian.lastName,
          relationship: link.guardian.relationship,
          phone: link.guardian.phone,
          isPrimary: link.isPrimary,
          canPickup: link.canPickup,
        })),
      };
    });
  }

  // ----------------------------------------------------------------------
  // create
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateStudentInput,
    reqCtx: RequestContext,
  ): Promise<StudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      try {
        const created = await db.student.create({
          data: {
            schoolId: authCtx.schoolId,
            admissionNumber: input.admissionNumber,
            firstName: input.firstName,
            middleName: input.middleName ?? null,
            lastName: input.lastName,
            dateOfBirth: input.dateOfBirth,
            gender: input.gender,
            photoUrl: input.photoUrl ?? null,
            address: input.address ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            bloodGroup: input.bloodGroup ?? null,
            medicalNotes: input.medicalNotes ?? null,
            religion: input.religion ?? null,
            stateOfOrigin: input.stateOfOrigin ?? null,
            nationality: input.nationality ?? "Nigerian",
            admittedAt: input.admittedAt ?? new Date(),
            notes: input.notes ?? null,
          },
          select: STUDENT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "student",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            // Audit metadata MUST stay free of identifying PII — see the
            // PII-redaction acceptance criterion in slice-4 cp2. Only the
            // admission number (school-assigned, non-identifying on its
            // own) and the gender bucket land here.
            metadata: {
              admissionNumber: created.admissionNumber,
              gender: created.gender,
            },
          },
        });

        return toStudentDto(created);
      } catch (e) {
        throw mapAdmissionNumberUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update — partial, status reachable directly. Named transitions
  // (withdraw / graduate / reactivate) use dedicated endpoints because
  // they also set/clear *At timestamps.
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateStudentInput,
    reqCtx: RequestContext,
  ): Promise<StudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.student.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Student not found.");

      const data: Prisma.StudentUpdateInput = {};
      if (input.admissionNumber !== undefined) data.admissionNumber = input.admissionNumber;
      if (input.firstName !== undefined) data.firstName = input.firstName;
      if (input.middleName !== undefined) data.middleName = input.middleName;
      if (input.lastName !== undefined) data.lastName = input.lastName;
      if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth;
      if (input.gender !== undefined) data.gender = input.gender;
      if (input.photoUrl !== undefined) data.photoUrl = input.photoUrl;
      if (input.address !== undefined) data.address = input.address;
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.email !== undefined) data.email = input.email;
      if (input.bloodGroup !== undefined) data.bloodGroup = input.bloodGroup;
      if (input.medicalNotes !== undefined) data.medicalNotes = input.medicalNotes;
      if (input.religion !== undefined) data.religion = input.religion;
      if (input.stateOfOrigin !== undefined) data.stateOfOrigin = input.stateOfOrigin;
      if (input.nationality !== undefined) data.nationality = input.nationality;
      if (input.status !== undefined) data.status = input.status;
      if (input.notes !== undefined) data.notes = input.notes;

      try {
        const updated = await db.student.update({
          where: { id },
          data,
          select: STUDENT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "student",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            // `changed` lists field NAMES only — no values — so PII can't
            // leak through audit metadata.
            metadata: { changed: Object.keys(data) },
          },
        });

        return toStudentDto(updated);
      } catch (e) {
        throw mapAdmissionNumberUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // withdraw — ACTIVE/INACTIVE/SUSPENDED → WITHDRAWN; sets withdrawnAt.
  // Rejects if already WITHDRAWN (409 ALREADY_WITHDRAWN); rejects if
  // GRADUATED (409 INVALID_TRANSITION) so a "graduated" mistake routes
  // through reactivate-first rather than silently overwriting.
  // ----------------------------------------------------------------------
  async withdraw(
    authCtx: AuthContext,
    id: string,
    input: WithdrawStudentInput,
    reqCtx: RequestContext,
  ): Promise<StudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.student.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundError("Student not found.");
      if (existing.status === "WITHDRAWN") {
        throw new ConflictError(
          "ALREADY_WITHDRAWN",
          "Student is already withdrawn.",
        );
      }
      if (existing.status === "GRADUATED") {
        throw new ConflictError(
          "INVALID_TRANSITION",
          "Cannot withdraw a graduated student. Reactivate first if this was an error.",
        );
      }

      const withdrawnAt = input.withdrawnAt ?? new Date();
      const updated = await db.student.update({
        where: { id },
        data: { status: "WITHDRAWN", withdrawnAt },
        select: STUDENT_SELECT,
      });

      // Slice 9 cascade — atomic in this same withTenant() tx so a
      // failure on the enrollment update rolls the student status
      // update back too. updateMany silently no-ops if there's no
      // current-term enrollment (a withdrawn-from-day-1 student); the
      // updated `count` lets the audit log record whether the cascade
      // actually flipped anything.
      const enrollmentCascade = await db.enrollment.updateMany({
        where: {
          studentId: id,
          term: { isCurrent: true },
          status: { not: "WITHDRAWN" },
        },
        data: { status: "WITHDRAWN", withdrawnAt },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.withdraw,
          entityType: "student",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            previousStatus: existing.status,
            withdrawnAt: withdrawnAt.toISOString(),
            reason: input.reason ?? null,
            // Slice 9: surface the cascade outcome in audit metadata so
            // forensic reads can tell whether the current-term row was
            // flipped or whether the student had no current enrollment.
            cascadedEnrollmentCount: enrollmentCascade.count,
          },
        },
      });

      return toStudentDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // graduate — ACTIVE/INACTIVE/SUSPENDED → GRADUATED; sets graduatedAt.
  // Rejects already-GRADUATED and WITHDRAWN (the latter symmetric to the
  // withdraw guard above).
  // ----------------------------------------------------------------------
  async graduate(
    authCtx: AuthContext,
    id: string,
    input: GraduateStudentInput,
    reqCtx: RequestContext,
  ): Promise<StudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.student.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundError("Student not found.");
      if (existing.status === "GRADUATED") {
        throw new ConflictError(
          "ALREADY_GRADUATED",
          "Student is already graduated.",
        );
      }
      if (existing.status === "WITHDRAWN") {
        throw new ConflictError(
          "INVALID_TRANSITION",
          "Cannot graduate a withdrawn student. Reactivate first if this was an error.",
        );
      }

      const graduatedAt = input.graduatedAt ?? new Date();
      const updated = await db.student.update({
        where: { id },
        data: { status: "GRADUATED", graduatedAt },
        select: STUDENT_SELECT,
      });

      // Slice 9 cascade — same atomicity guarantee as withdraw.
      const enrollmentCascade = await db.enrollment.updateMany({
        where: {
          studentId: id,
          term: { isCurrent: true },
          status: { not: "GRADUATED" },
        },
        data: { status: "GRADUATED" },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.graduate,
          entityType: "student",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            previousStatus: existing.status,
            graduatedAt: graduatedAt.toISOString(),
            reason: input.reason ?? null,
            cascadedEnrollmentCount: enrollmentCascade.count,
          },
        },
      });

      return toStudentDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // reactivate — any non-ACTIVE → ACTIVE; clears withdrawnAt AND
  // graduatedAt (whichever was set). Rejects if already ACTIVE because
  // the action would be a silent no-op otherwise.
  // ----------------------------------------------------------------------
  async reactivate(
    authCtx: AuthContext,
    id: string,
    input: ReactivateStudentInput,
    reqCtx: RequestContext,
  ): Promise<StudentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.student.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundError("Student not found.");
      if (existing.status === "ACTIVE") {
        throw new ConflictError(
          "ALREADY_ACTIVE",
          "Student is already active.",
        );
      }

      const updated = await db.student.update({
        where: { id },
        data: { status: "ACTIVE", withdrawnAt: null, graduatedAt: null },
        select: STUDENT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.reactivate,
          entityType: "student",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            previousStatus: existing.status,
            reason: input?.reason ?? null,
          },
        },
      });

      return toStudentDto(updated);
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const STUDENT_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  dateOfBirth: true,
  gender: true,
  photoUrl: true,
  address: true,
  phone: true,
  email: true,
  bloodGroup: true,
  medicalNotes: true,
  religion: true,
  stateOfOrigin: true,
  nationality: true,
  status: true,
  admittedAt: true,
  withdrawnAt: true,
  graduatedAt: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StudentSelect;

type StudentRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_SELECT }>;

export function toStudentDto(row: StudentRow): StudentDto {
  return {
    id: row.id,
    admissionNumber: row.admissionNumber,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    dateOfBirth: row.dateOfBirth,
    gender: row.gender,
    photoUrl: row.photoUrl,
    address: row.address,
    phone: row.phone,
    email: row.email,
    bloodGroup: row.bloodGroup,
    medicalNotes: row.medicalNotes,
    religion: row.religion,
    stateOfOrigin: row.stateOfOrigin,
    nationality: row.nationality,
    status: row.status,
    admittedAt: row.admittedAt,
    withdrawnAt: row.withdrawnAt,
    graduatedAt: row.graduatedAt,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// students has one unique-per-school constraint: (school_id, admission_number).
// Any P2002 from create / update is an admission-number collision. RLS hides
// the constraint name (see CLAUDE.md "RLS hides constraint name on uniqueness
// errors"), but this is the only unique on the table so the discriminator is
// unambiguous.
function mapAdmissionNumberUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "ADMISSION_NUMBER_TAKEN",
      "A student with that admission number already exists.",
    );
  }
  return e;
}
