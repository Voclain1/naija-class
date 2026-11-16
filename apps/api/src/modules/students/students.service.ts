import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  BULK_STUDENT_CONFLICT_CODE,
  deriveGuardianPortalStatus,
  ConflictError,
  type BulkCreateStudentsInput,
  type BulkCreateStudentsResponse,
  type BulkStudentConflictDetails,
  NotFoundError,
  ValidationError,
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
import { removeTransportAfterWithdrawal } from "../transport/transport.service";
import { removeHostelBedsAfterWithdrawal } from "../hostels/hostel.service";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { assertRoomForStudents } from "../../common/plans/plan-limits";
import {
  admissionYear,
  assignAdmissionNumbers,
  classCodeForArm,
  loadNumbering,
} from "./admission-numbers";
import {
  insertEnrollmentInTx,
  loadCurrentEnrollmentForStudent,
  loadCurrentEnrollmentsForStudents,
} from "../enrollments/enrollments.service";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming â€” singular resource, dotted verb (locked in slice 1).
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
  // list â€” cursor-paginated, id ASC.
  //
  // Cursor is on `id` (UUID) rather than (lastName, firstName, id) because
  // status changes do not move ids â€” a student withdrawn between page-1
  // and page-2 is still on the next page in the same position. Spec
  // accepts the cosmetic trade-off (alphabetical paging would require a
  // composite cursor; out of scope for cp2).
  //
  // Slice 9: `classArmId` is now a real filter (joins through Enrollment
  // to the student's CURRENT-term enrollment); `academicYearId` stays
  // accepted-but-unused until a more nuanced "ever-enrolled-in-year"
  // filter is requested. The current-arm column is populated by ONE
  // batched query (loadCurrentEnrollmentsForStudents) â€” see the slice-9
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
  // findById â€” Student detail + linked guardians (populated by slice 5).
  //
  // Returns guardians as StudentGuardianRefDto[] â€” the "guardian from a
  // student's POV" shape declared in StudentDetailDto. Phone is included
  // because the admin detail view needs it for the "call this guardian"
  // contact card; the redactor masks it before Sentry ships it. Email is
  // included so the Guardians tab can disable the portal-invite action
  // with an explanation instead of round-tripping to learn
  // GUARDIAN_HAS_NO_EMAIL.
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
                  email: true,
                  // Portal facts â€” passwordHash is read only to derive the
                  // hasPassword boolean below and never reaches the DTO.
                  passwordHash: true,
                  portalDisabledAt: true,
                  invitations: {
                    select: { acceptedAt: true, revokedAt: true, expiresAt: true },
                  },
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
          email: link.guardian.email,
          portalStatus: deriveGuardianPortalStatus({
            portalDisabled: link.guardian.portalDisabledAt !== null,
            hasEmail: link.guardian.email !== null,
            hasPassword: link.guardian.passwordHash !== null,
            invitations: link.guardian.invitations,
          }).status,
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

    if (input.creationRequestId) {
      const prior = await withTenant(authCtx.schoolId, (db) => db.student.findUnique({
        where: { schoolId_creationRequestId: { schoolId: authCtx.schoolId, creationRequestId: input.creationRequestId! } },
        select: STUDENT_SELECT,
      }));
      if (prior) return toStudentDto(prior);
    }

    try {
      return await withTenant(authCtx.schoolId, (db) => createStudentInTx(db, authCtx, input, reqCtx));
    } catch (error) {
      // Two copies of the same request may race. The unique key chooses the
      // winner; after the losing transaction rolls back, return that winner.
      if (input.creationRequestId) {
        const prior = await withTenant(authCtx.schoolId, (db) => db.student.findUnique({
          where: { schoolId_creationRequestId: { schoolId: authCtx.schoolId, creationRequestId: input.creationRequestId! } },
          select: STUDENT_SELECT,
        }));
        if (prior) return toStudentDto(prior);
      }
      throw error;
    }
  }

  // ----------------------------------------------------------------------
  // bulkCreate â€” the bulk add grid's one request (POST /students/bulk).
  //
  // All or nothing. Every admission number is checked before anything is
  // written: one repeated within the request, or already on the school's
  // roll, fails the whole request with a 409 naming each row, so the grid can
  // mark exactly those rows and nothing is left half-created. Then one
  // multi-row INSERT and one multi-row audit INSERT, in the same transaction:
  // a fixed number of round trips whatever the row count, where the grid used
  // to send one request per student.
  // ----------------------------------------------------------------------
  async bulkCreate(
    authCtx: AuthContext,
    input: BulkCreateStudentsInput,
    reqCtx: RequestContext,
  ): Promise<BulkCreateStudentsResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    // Typed numbers only: a blank one is assigned below, after the checks.
    const typed = input.students.map((s) => s.admissionNumber);
    const conflicts: BulkStudentConflictDetails["rows"] = [];
    const firstSeen = new Map<string, number>();
    typed.forEach((n, index) => {
      if (!n) return;
      if (firstSeen.has(n)) conflicts.push({ index, reason: "REPEATED_IN_REQUEST" });
      else firstSeen.set(n, index);
    });

    return withTenant(authCtx.schoolId, async (db) => {
      const taken = await db.student.findMany({
        where: { admissionNumber: { in: [...firstSeen.keys()] } },
        select: { admissionNumber: true },
      });
      for (const { admissionNumber } of taken) {
        conflicts.push({ index: firstSeen.get(admissionNumber)!, reason: "TAKEN" });
      }
      if (conflicts.length > 0) {
        conflicts.sort((a, b) => a.index - b.index);
        throw new ConflictError(
          BULK_STUDENT_CONFLICT_CODE,
          conflicts.length === 1
            ? "One admission number is already in use. Nothing was added."
            : `${conflicts.length} admission numbers are already in use. Nothing was added.`,
          { rows: conflicts } satisfies BulkStudentConflictDetails,
        );
      }

      await assertRoomForStudents(db, authCtx.schoolId, input.students.length);

      // The batch's class: checked once, then placed with one insert below.
      const placement = input.enrollment ? await loadPlacement(db, input.enrollment) : null;

      // Blank numbers, in row order, when the school numbers automatically.
      const blanks = typed.flatMap((n, index) => (n ? [] : [index]));
      const numbers = [...typed];
      if (blanks.length > 0) {
        const numbering = await loadNumbering(db, authCtx.schoolId);
        if (!numbering) {
          throw new ValidationError(
            "ADMISSION_NUMBER_REQUIRED",
            blanks.length === 1
              ? "One row has no admission number. Enter it, or turn on automatic numbering in Settings."
              : `${blanks.length} rows have no admission number. Enter them, or turn on automatic numbering in Settings.`,
            { rows: blanks.map((index) => ({ index })) },
          );
        }
        const assigned = await assignAdmissionNumbers(
          db,
          authCtx.schoolId,
          numbering,
          blanks.map(() => ({ classCode: placement?.classCode })),
          { taken: new Set(firstSeen.keys()) },
        );
        blanks.forEach((index, k) => {
          numbers[index] = assigned[k];
        });
      }

      try {
        const inserted = await insertStudentBatchInTx(db, authCtx, input.students, numbers as string[], placement, reqCtx, {
          student: { via: "bulk" },
          enrollment: { via: "student-bulk-create" },
        });
        return { created: inserted.map((r) => r.student) };
      } catch (e) {
        // A row added between the check above and this insert.
        throw mapAdmissionNumberUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update â€” partial, status reachable directly. Named transitions
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
            // `changed` lists field NAMES only â€” no values â€” so PII can't
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
  // withdraw â€” ACTIVE/INACTIVE/SUSPENDED â†’ WITHDRAWN; sets withdrawnAt.
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

      // Slice 9 cascade â€” atomic in this same withTenant() tx so a
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

      // Phase 9 / CP5.2 â€” places on a bus in terms that start later are
      // freed, and their waiting transport charges voided, in this same
      // transaction (docs/modules/phase-9.md Â§13 CP5-D8).
      const transportPlacesRemoved = await removeTransportAfterWithdrawal(
        db,
        { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress },
        id,
        withdrawnAt,
      );
      // Phase 9 / CP6b.1 â€” beds in later terms are freed the same way, and
      // their waiting hostel charges voided (Â§15 CP6b-D3).
      const hostelBedsRemoved = await removeHostelBedsAfterWithdrawal(
        db,
        { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress },
        id,
        withdrawnAt,
      );

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
            transportPlacesRemoved,
            hostelBedsRemoved,
          },
        },
      });

      return toStudentDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // graduate â€” ACTIVE/INACTIVE/SUSPENDED â†’ GRADUATED; sets graduatedAt.
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

      // Slice 9 cascade â€” same atomicity guarantee as withdraw.
      const enrollmentCascade = await db.enrollment.updateMany({
        where: {
          studentId: id,
          term: { isCurrent: true },
          status: { not: "GRADUATED" },
        },
        data: { status: "GRADUATED" },
      });

      // As on withdrawal: bus places and beds in terms that start after the
      // graduation are freed, and their waiting charges voided.
      const leaver = { schoolId: authCtx.schoolId, userId: authCtx.userId, ipAddress: reqCtx.ipAddress };
      await removeTransportAfterWithdrawal(db, leaver, id, graduatedAt);
      await removeHostelBedsAfterWithdrawal(db, leaver, id, graduatedAt);

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
  // reactivate â€” any non-ACTIVE â†’ ACTIVE; clears withdrawnAt AND
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
  photoUploadedAt: true,
  address: true,
  phone: true,
  email: true,
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
    hasPhoto: row.photoUploadedAt !== null,
    address: row.address,
    phone: row.phone,
    email: row.email,
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

// ----------------------------------------------------------------------
// createStudentInTx â€” the body of create, inside the caller's transaction.
//
// Exported for Phase 9 / CP7.2's Admit (docs/modules/phase-9.md Â§16.8), so a
// child admitted from an application goes through exactly the same rules as
// one typed in: the plan's student cap, the admission-number rule (including
// the CLASS order) and the unique number, with the optional placement in the
// same transaction. The CALLER checks the role.
// ----------------------------------------------------------------------
export async function createStudentInTx(
  db: PrismaClient,
  authCtx: Pick<AuthContext, "schoolId" | "userId">,
  input: CreateStudentInput,
  reqCtx: RequestContext,
): Promise<StudentDto> {
  // The plan's student cap: blocks only under PLAN_ENFORCEMENT=enforce
  // (docs/modules/plans.md D3).
  await assertRoomForStudents(db, authCtx.schoolId, 1);

  // A blank number is SchoolKit's to give when the school numbers
  // automatically (docs/modules/admission-numbers.md); a typed one wins.
  let admissionNumber = input.admissionNumber;
  if (!admissionNumber) {
    const numbering = await loadNumbering(db, authCtx.schoolId);
    if (!numbering) {
      throw new ValidationError("ADMISSION_NUMBER_REQUIRED", "Enter the student's admission number.");
    }
    const classCode = input.enrollment ? await classCodeForArm(db, input.enrollment.classArmId) : undefined;
    [admissionNumber] = await assignAdmissionNumbers(db, authCtx.schoolId, numbering, [{ classCode }], {
      year: admissionYear(input.admittedAt ?? new Date()),
    });
  }

  try {
    const created = await db.student.create({
      data: {
        schoolId: authCtx.schoolId,
        admissionNumber: admissionNumber!,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        photoUrl: input.photoUrl ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        religion: input.religion ?? null,
        stateOfOrigin: input.stateOfOrigin ?? null,
        nationality: input.nationality ?? "Nigerian",
        admittedAt: input.admittedAt ?? new Date(),
        notes: input.notes ?? null,
        creationRequestId: input.creationRequestId ?? null,
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
        // Audit metadata MUST stay free of identifying PII â€” see the
        // PII-redaction acceptance criterion in slice-4 cp2. Only the
        // admission number (school-assigned, non-identifying on its
        // own) and the gender bucket land here.
        metadata: {
          admissionNumber: created.admissionNumber,
          gender: created.gender,
        },
      },
    });

    // ---- optional placement, in the SAME transaction ----------------
    //
    // student-import-enrollment.md D6, applied to the single-student path:
    // all-or-nothing. If the enrollment fails â€” an inactive arm, a term
    // that vanished, a student already enrolled this term â€” the student
    // insert rolls back with it, and the admin sees one error instead of a
    // half-created record they now have to reason about.
    //
    // Absent `enrollment` is a first-class case, not a degraded one: a
    // school mid-admission legitimately holds unplaced students (D5).
    if (input.enrollment) {
      const enrollment = await insertEnrollmentInTx(db, authCtx.schoolId, {
        studentId: created.id,
        termId: input.enrollment.termId,
        classArmId: input.enrollment.classArmId,
      });

      // Audited as its own event rather than folded into the student's.
      // "Who put this child in this class, and when" is a question asked
      // of enrollments, and an auditor filtering on enrollment.create must
      // see this row alongside the ones the enrollments surface writes.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "enrollment.create",
          entityType: "enrollment",
          entityId: enrollment.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: created.id,
            termId: enrollment.termId,
            classArmId: enrollment.classArmId,
            status: "ENROLLED",
            // Distinguishes this from an enrollment made on the
            // enrollments surface, which is what makes "did placing at
            // creation actually get used?" answerable later.
            via: "student-create",
          },
        },
      });
    }

    return toStudentDto(created);
  } catch (e) {
    throw mapAdmissionNumberUniqueViolation(e);
  }
}

// students has one unique-per-school constraint: (school_id, admission_number).
// Any P2002 from create / update is an admission-number collision. RLS hides
// the constraint name (see CLAUDE.md "RLS hides constraint name on uniqueness
// errors"), but this is the only unique on the table so the discriminator is
// unambiguous.
export function mapAdmissionNumberUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "ADMISSION_NUMBER_TAKEN",
      "A student with that admission number already exists.",
    );
  }
  return e;
}

// The bulk add's one class (POST /students/bulk `enrollment`), checked once:
// the same checks insertEnrollmentInTx makes per student.
export async function loadPlacement(
  db: Prisma.TransactionClient,
  input: { termId: string; classArmId: string },
): Promise<{ termId: string; academicYearId: string; classArmId: string; classCode: string }> {
  const term = await db.term.findUnique({ where: { id: input.termId }, select: { academicYearId: true } });
  if (!term) throw new NotFoundError("Term not found.");
  const arm = await db.classArm.findUnique({
    where: { id: input.classArmId },
    select: { isActive: true, classLevel: { select: { code: true } } },
  });
  if (!arm) throw new NotFoundError("Class arm not found.");
  if (!arm.isActive) {
    throw new ValidationError("INACTIVE_CLASS_ARM", "Cannot enroll a student into an inactive class arm.");
  }
  return { termId: input.termId, academicYearId: term.academicYearId, classArmId: input.classArmId, classCode: arm.classLevel.code };
}

export type StudentBatchRow = Omit<CreateStudentInput, "enrollment">;
export type StudentPlacement = Awaited<ReturnType<typeof loadPlacement>>;

/**
 * The shared write behind POST /students/bulk and the reviewed intake's
 * confirm (docs/modules/student-intake-proposals.md). Runs inside the
 * caller's transaction, after the caller has checked numbers, room and
 * placement: one multi-row student INSERT, one audit row per student, and,
 * with a placement, one multi-row enrolment INSERT with its own audit rows.
 * `attribution` is merged into each audit row's PII-free metadata; it says
 * how the row was added, never who or what drafted it. Sends nothing: no
 * invitation, no notification. Returns rows in the order they were given.
 */
export async function insertStudentBatchInTx(
  db: Prisma.TransactionClient | PrismaClient,
  authCtx: AuthContext,
  students: StudentBatchRow[],
  numbers: string[],
  placement: StudentPlacement | null,
  reqCtx: RequestContext,
  attribution: { student: Record<string, string>; enrollment: Record<string, string> },
): Promise<{ student: StudentDto; enrollmentId: string | null }[]> {
  const now = new Date();
  const rows = await db.student.createManyAndReturn({
    data: students.map((s, index) => ({
      schoolId: authCtx.schoolId,
      admissionNumber: numbers[index]!,
      firstName: s.firstName,
      middleName: s.middleName ?? null,
      lastName: s.lastName,
      dateOfBirth: s.dateOfBirth,
      gender: s.gender,
      photoUrl: s.photoUrl ?? null,
      address: s.address ?? null,
      phone: s.phone ?? null,
      email: s.email ?? null,
      religion: s.religion ?? null,
      stateOfOrigin: s.stateOfOrigin ?? null,
      nationality: s.nationality ?? "Nigerian",
      admittedAt: s.admittedAt ?? now,
      notes: s.notes ?? null,
    })),
    select: STUDENT_SELECT,
  });

  // One audit row per student, as the single add writes: the same action
  // and the same PII-free metadata, plus how it was added.
  await db.auditLog.createMany({
    data: rows.map((created) => ({
      schoolId: authCtx.schoolId,
      userId: authCtx.userId,
      action: AUDIT.create,
      entityType: "student",
      entityId: created.id,
      ipAddress: reqCtx.ipAddress,
      metadata: {
        admissionNumber: created.admissionNumber,
        gender: created.gender,
        ...attribution.student,
      },
    })),
  });

  const enrollmentByStudent = new Map<string, string>();
  if (placement) {
    const enrollments = await db.enrollment.createManyAndReturn({
      data: rows.map((r) => ({
        schoolId: authCtx.schoolId,
        studentId: r.id,
        termId: placement.termId,
        academicYearId: placement.academicYearId,
        classArmId: placement.classArmId,
        status: "ENROLLED" as const,
      })),
      select: { id: true, studentId: true },
    });
    // As the single add audits a placement: its own event, per student.
    await db.auditLog.createMany({
      data: enrollment}wënw¶‰Ëkºwµç[
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÚ]˜]Û]]U[YOÈX\
Ú]˜]Û—Ø]ŠBˆÚ]˜]ÛHİš[™ÏÈX\
Ú]˜]Û—ØHŠBˆYYXØ][ÛœÈÚXÚØ˜^SYYXØ][Û–×Bˆ›İXÙ\ÈÚXÚØ˜^S›İXÙV×B‚ˆ[™^
ÜØÚÛÛYš\Ú]Y]JBˆ[™^
ÜØÚÛÛYİY[YJBˆX\
œÚXÚØ˜^Wİš\Ú]ÈŠBŸB‚›[Ù[ÚXÚØ˜^SYYXØ][ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆš\Ú]Yİš[™ÈX\
š\Ú]ÚYŠBˆš\Ú]ÚXÚØ˜^Uš\Ú]™[][ÛŠšY[Îˆİš\Ú]YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ˜[YHİš[™ÂˆÜÙHİš[™ÂˆÚ]™[]]U[YHX\
™Ú]™[—Ø]ŠBˆÚ]™[Hİš[™ÈX\
™Ú]™[—ØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ[™^
İš\Ú]YJBˆX\
œÚXÚØ˜^WÛYYXØ][ÛœÈŠBŸB‚‹ËÈÛ˜ÙH\ˆİX\™X[ˆ\ˆš\Ú]
ÔËQŠK‚›[Ù[ÚXÚØ˜^S›İXÙHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆš\Ú]Yİš[™ÈX\
š\Ú]ÚYŠBˆš\Ú]ÚXÚØ˜^Uš\Ú]™[][ÛŠšY[Îˆİš\Ú]YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİX\™X[’Yİš[™ÈX\
™İX\™X[—ÚYŠBˆËÈ”TÒ‹”ÓTÈˆÜˆ““Ó‘H‹‚ˆÚ[›™[İš[™ÂˆÙ[]]U[YHY˜][
›İÊ
JHX\
œÙ[Ø]ŠB‚ˆ[š\]YJİš\Ú]YİX\™X[’YJBˆX\
œÚXÚØ˜^WÛ›İXÙ\ÈŠBŸB‚‹ËÈ\ÙHHÈÔ8 %\ÜÚYÛ›Y[ÎˆİX›Z]YÛÜšÈ[™X\šÚ[™Â‹ËÈ
ØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌLJKˆÛÛXİÛÜšÈˆİÚ]ÚYÛˆ›ÜˆÛ™HÛY]ÛÜšÂ‹ËÈ][Kˆ™XY[™X\šÙYHİÛ™\‹YZ[ˆ[™HÛ\ÜÉÜÈXXÚ\œÂ‹ËÈ
\ÜÚYÛ›Y[œ™XYÈ\ÜÚYÛ›Y[›X\šÊNÈ™]™\ˆH\œØ\‹‚›[Ù[\ÜÚYÛ›Y[ÛÛXİ[ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ\ÜÚYÛ›Y[Yİš[™È[š\]YHX\
˜\ÜÚYÛ›Y[ÚYŠBˆ\ÜÚYÛ›Y[\ÜÚYÛ›Y[™[][ÛŠšY[ÎˆØ\ÜÚYÛ›Y[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİ[X\šÜÈ[X\
İ[ÛX\šÜÈŠBˆËÈÙ™ˆÛ˜ÙHHXXÚ\ˆÛXÚÜÈ”İÜXØÙ\[™ÈÛÜšÈ‹‚ˆXØÙ\[™È›ÛÛX[ˆY˜][
YJBˆËÈÔˆÚ]HÛÛÙ[œİÙ\ˆ[˜ÛY\ËˆİY™ˆÛ›NÈÙ[ÈHRH˜Y\‹‚ˆX\šÚ[™ÑİZYHİš[™ÏÈX\
›X\šÚ[™×ÙİZYHŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YHY˜][
›İÊ
JH\]Y]X\
\]YØ]ŠBˆİX›Z\ÜÚ[ÛœÈ\ÜÚYÛ›Y[İX›Z\ÜÚ[Û–×Bˆš[\È\ÜÚYÛ›Y[İX›Z\ÜÚ[Û‘š[V×Bˆ]Y\İ[ÛœÈ\ÜÚYÛ›Y[]Y\İ[Û–×B‚ˆX\
˜\ÜÚYÛ›Y[ØÛÛXİ[ÛœÈŠBŸB‚‹ËÈÛ™H›İÈ\ˆİY[\ˆ][\ˆHİX›Z]Y][\\Èš[˜[ÈH™]\›‚‹ËÈÜ[œÈH™^][\[™\ÈÛ™H\ÈÙ\\È]Ø\Ë‚›[Ù[\ÜÚYÛ›Y[İX›Z\ÜÚ[ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÛÛXİ[Û’Yİš[™ÈX\
˜ÛÛXİ[Û—ÚYŠBˆÛÛXİ[Ûˆ\ÜÚYÛ›Y[ÛÛXİ[Ûˆ™[][ÛŠšY[ÎˆØÛÛXİ[Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ][\[ˆËÈ[Ú[ˆH][\\Èš[\È[Û™H
ÔŒŠK‚ˆ›ÙHİš[™ÏÂˆËÈMÉÜÈ\İH[™XØ]Ü‹\È™\ÜYHHİY[	ÜÈİÛˆ]šXÙKˆÚİÛˆÂˆËÈHXXÚ\ˆÛ›NÈ™]™\ˆÈHİY[Üˆ\™[Ë™]™\ˆ[ˆHX\šË‚ˆ\YÚ\œÈ[Y˜][

HX\
\YØÚ\œÈŠBˆ\İYÚ\œÈ[Y˜][

HX\
œ\İYØÚ\œÈŠBˆİX›Z]Y]]U[YHY˜][
›İÊ
JHX\
œİX›Z]YØ]ŠBˆËÈY\ˆHYH]IÜÈØÚÛÛ^H
YÛÜÊKÛÜšÙYİ]HHÙ\™\‹‚ˆ]H›ÛÛX[ˆY˜][
˜[ÙJBˆX\šÈ[Âˆ™YY˜XÚÈİš[™ÏÂˆX\šÙYHİš[™ÏÈX\
›X\šÙYØHŠBˆX\šÙY]]U[YOÈX\
›X\šÙYØ]ŠBˆËÈHİY[[™\™[ÈÙYHHX\šÈ[™™YY˜XÚÈÛ›HÛ˜ÙH™[X\ÙY‚ˆ™[X\ÙY]]U[YOÈX\
œ™[X\ÙYØ]ŠBˆ™]\›™YHİš[™ÏÈX\
œ™]\›™YØHŠBˆ™]\›™Y]]U[YOÈX\
œ™]\›™YØ]ŠBˆ™]\›“›İHİš[™ÏÈX\
œ™]\›—Û›İHŠBˆš[\È\ÜÚYÛ›Y[İX›Z\ÜÚ[Û‘š[V×BˆËÈÔŒÎˆH[œİÙ\œÈÈH]Y\İ[ÛœËÙ^YYH]Y\İ[ÛˆY
][\BˆËÈÚÚXÙNˆHÜ[Û‰ÜÈ[™^Èš[Z[ˆH^
K[™HX\šÈHÙ\™\‚ˆËÈÛÜšÙYİ]œ›ÛH[KˆHXXÚ\ˆÚ]™\ÈH™X[X\šË‚ˆ[œİÙ\œÈœÛÛÂˆ]]ÓX\šÈ[ÈX\
˜]]×ÛX\šÈŠBˆËÈÔˆHØ]™YX\šÈİ\Yœ›ÛH[ˆRH˜Y
HXXÚ\ˆØ]™Y]
K‚ˆ™YY˜XÚĞZQ˜YY›ÛÛX[ˆY˜][
˜[ÙJHX\
™™YY˜XÚ×ØZWÙ˜YYŠBˆ™YY˜XÚÑ˜Y\ÜÚYÛ›Y[™YY˜XÚÑ˜YÂ‚ˆ[š\]YJØÛÛXİ[Û’YİY[Y][\JBˆ[™^
ÜØÚÛÛYİY[YJBˆX\
˜\ÜÚYÛ›Y[ÜİX›Z\ÜÚ[ÛœÈŠBŸB‚‹ËÈ\ÙHHÈÔŒˆ8 %HİÈÜˆˆ[œİÙ\ˆ
N
KˆÕQÑQÚ[HİX›Z\ÜÚ[Û’Y\Â‹ËÈ[
HİY[\ÈÙ][™È™XYHÈ[™[ŠNÈ]XÚY[™š[˜[Û˜ÙB‹ËÈH][\\È[™Y[‹ˆ\Hœ›ÛHHš[IÜÈİÛˆ]\È
ŒJK‚›[Ù[\ÜÚYÛ›Y[İX›Z\ÜÚ[Û‘š[HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÛÛXİ[Û’Yİš[™ÈX\
˜ÛÛXİ[Û—ÚYŠBˆÛÛXİ[Ûˆ\ÜÚYÛ›Y[ÛÛXİ[Ûˆ™[][ÛŠšY[ÎˆØÛÛXİ[Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİX›Z\ÜÚ[Û’Yİš[™ÏÈX\
œİX›Z\ÜÚ[Û—ÚYŠBˆİX›Z\ÜÚ[Ûˆ\ÜÚYÛ›Y[İX›Z\ÜÚ[ÛÈ™[][ÛŠšY[ÎˆÜİX›Z\ÜÚ[Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ^İš[™ÂˆÚ^™H[ˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ[™^
ØÛÛXİ[Û’YİY[YJBˆ[™^
ÜİX›Z\ÜÚ[Û’YJBˆX\
˜\ÜÚYÛ›Y[ÜİX›Z\ÜÚ[Û—Ùš[\ÈŠBŸB‚‹ËÈ\ÙHHÈÔŒÈ8 %H]Y\İ[ÛˆÛˆÛÛXİYÛÜšËX\šÙY]]ÛX]XØ[B‹ËÈ
ÔQŠKˆš^YÛ˜ÙH[[Û™H\È[™Y[‹‚™[[H\ÜÚYÛ›Y[]Y\İ[Û•\HÂˆUSTWĞÒÒPÑBˆ’SÒS‚ŸB‚›[Ù[\ÜÚYÛ›Y[]Y\İ[ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÛÛXİ[Û’Yİš[™ÈX\
˜ÛÛXİ[Û—ÚYŠBˆÛÛXİ[Ûˆ\ÜÚYÛ›Y[ÛÛXİ[Ûˆ™[][ÛŠšY[ÎˆØÛÛXİ[Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆÜ™\’[™^[X\
›Ü™\—Ú[™^ŠBˆ\H\ÜÚYÛ›Y[]Y\İ[Û•\Bˆ^İš[™ÂˆX\šÜÈ[ˆËÈ][\HÚÚXÙNˆHÜ[ÛœÉÈ^[ˆÜ™\‹[™ÚXÚÛ™H\ÈšYÚ‚ˆÜ[ÛœÈœÛÛÂˆÛÜœ™Xİ[™^[ÈX\
˜ÛÜœ™XİÚ[™^ŠBˆËÈš[Z[ˆ]™\HXØÙ\Y[œİÙ\‹\ÈHXXÚ\ˆ\Y[K‚ˆXØÙ\Y[œİÙ\œÈœÛÛÈX\
˜XØÙ\YØ[œİÙ\œÈŠBˆËÈH]Y\İ[Û‹X˜[šÈ]Y\İ[Ûˆ\ÈØ\ÈÛÜYYœ›ÛKˆHZ[ˆÛÛ[[ˆHÛÜBˆËÈİ[™ÈÛˆ]ÈİÛˆ[™H˜[šÈ]Y\İ[ÛˆX^H]\ˆ™H™]\™Y‚ˆÛİ\˜ÙT]Y\İ[Û’Yİš[™ÏÈX\
œÛİ\˜ÙWÜ]Y\İ[Û—ÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ[š\]YJØÛÛXİ[Û’YÜ™\’[™^JBˆX\
˜\ÜÚYÛ›Y[Ü]Y\İ[ÛœÈŠBŸB‚‹ËÈ\ÙHHÈÔˆ8 %[ˆRH˜YÙˆHX\šÈ[™™YY˜XÚË›ÜˆİY™ˆÛ›Kˆ™]™\ˆB‹ËÈX\šÎˆHXXÚ\‰ÜÈİÛˆ”Ø]™HX\šÈˆÜš]\È]
ØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌLŠK‚™[[H\ÜÚYÛ›Y[™YY˜XÚÑ˜Yİ]\ÈÂˆS‘S‘Âˆ‘PQBˆRSQŸB‚›[Ù[\ÜÚYÛ›Y[™YY˜XÚÑ˜YÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİX›Z\ÜÚ[Û’Yİš[™È[š\]YHX\
œİX›Z\ÜÚ[Û—ÚYŠBˆİX›Z\ÜÚ[Ûˆ\ÜÚYÛ›Y[İX›Z\ÜÚ[Ûˆ™[][ÛŠšY[ÎˆÜİX›Z\ÜÚ[Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİ]\È\ÜÚYÛ›Y[™YY˜XÚÑ˜Yİ]\ÈY˜][
S‘S‘ÊBˆX\šÈ[Âˆ™YY˜XÚÈİš[™ÏÂˆËÈÛ™H[™H›ÜˆHXXÚ\ˆÛˆÚH]X\šÎÈHİY[™]™\ˆÙY\È]‚ˆ™X\ÛÛˆİš[™ÏÂˆËÈÚH]˜Z[Y[ˆÛÜ™ÈHXXÚ\ˆØ[ˆ™XY‚ˆ˜Z[\™Hİš[™ÏÂˆ›Û\™\œÚ[Ûˆİš[™ÈX\
œ›Û\İ™\œÚ[ÛˆŠBˆ™\]Y\İYHİš[™ÈX\
œ™\]Y\İYØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YHY˜][
›İÊ
JH\]Y]X\
\]YØ]ŠB‚ˆX\
˜\ÜÚYÛ›Y[Ù™YY˜XÚ×Ù˜YÈŠBŸB‚‹ËÈKKKKKKKKKH\ÙHHÈÔKŒˆ8 %˜[œÜÜKKKKKKKKKB‹ËÂ‹ËÈØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌLÈÔKQËÑˆ™ZXÛ\Ëš]™\œË›İ]\ÈÚ]Ü™\™Y‹ËÈİÜË[™XXÚİY[	ÜÈXÙHÛˆÛ™H›İ]H[™İÜ\ˆ\›KˆHXÙB‹ËÈ˜Z\Ù\ÈHS”ÔÔ•İY[Ú\™ÙH]H›İ]IÜÈ™YK›İYÚ‹ËÈİY[Ú\™ÙTÙ\šXÙHÛ›H
Ûİ\˜ÙH˜[œÜÜ‹H\ÜÚYÛ›Y[	ÜÈY
KˆB‹ËÈ›İ]HZÙ\È›È[Ü™HÚ[™[ˆ[ˆH\›H[ˆ]È™ZXÛH\ÈÙX]Ë‚‚›[Ù[˜[œÜÜ™ZXÛHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]Hİš[™ÈËÈ›Ü›X[\ÙY\\ˆØ\ÙK[š\]YH\ˆØÚÛÛˆ\ØÜš\[Ûˆİš[™ÏÂˆÙX]È[ˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ›İ]\È˜[œÜÜ›İ]V×B‚ˆ[š\]YJÜØÚÛÛY]WJBˆX\
˜[œÜÜİ™ZXÛ\ÈŠBŸB‚›[Ù[˜[œÜÜš]™\ˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜[YHİš[™ÂˆÛ™Hİš[™ÂˆXÙ[˜ÙS[X™\ˆİš[™ÏÈX\
›XÙ[˜ÙWÛ[X™\ˆŠBˆXÙ[˜ÙQ^\H]U[YOÈX\
›XÙ[˜ÙWÙ^\HŠH‹‘]BˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ›İ]\È˜[œÜÜ›İ]V×B‚ˆ[™^
ÜØÚÛÛYJBˆX\
˜[œÜÜÙš]™\œÈŠBŸB‚›[Ù[˜[œÜÜ›İ]HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜[YHİš[™Âˆ™ZXÛRYİš[™ÏÈX\
™ZXÛWÚYŠBˆš]™\’Yİš[™ÏÈX\
™š]™\—ÚYŠBˆËÈ\ˆ\›K[ˆÛØ›ËˆHœ™YNˆ›ÈÚ\™ÙH\È˜Z\ÙY‚ˆ™YH[Y˜][

BˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ™ZXÛH˜[œÜÜ™ZXÛOÈ™[][ÛŠšY[Îˆİ™ZXÛRYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
Bˆš]™\ˆ˜[œÜÜš]™\È™[][ÛŠšY[ÎˆÙš]™\’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
BˆİÜÈ˜[œÜÜİÜ×Bˆ\ÜÚYÛ›Y[È˜[œÜÜ\ÜÚYÛ›Y[×B‚ˆ[š\]YJÜØÚÛÛY˜[YWJBˆX\
˜[œÜÜÜ›İ]\ÈŠBŸB‚›[Ù[˜[œÜÜİÜÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ›İ]RYİš[™ÈX\
œ›İ]WÚYŠBˆ˜[YHİš[™ÂˆÜÚ][Ûˆ[ˆËÈZ[]\ÈÚ[˜ÙHZYšYÚØÚÛÛØ[XÛØÚÈ[YH
ÓUQK›Y[YK[Ù‹Y^H[JK‚ˆXÚİ\Z[]H[ÈX\
œXÚİ\ÛZ[]HŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ›İ]H˜[œÜÜ›İ]H™[][ÛŠšY[ÎˆÜ›İ]RYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ\ÜÚYÛ›Y[È˜[œÜÜ\ÜÚYÛ›Y[×B‚ˆ[™^
Ü›İ]RYÜÚ][Û—JBˆX\
˜[œÜÜÜİÜÈŠBŸB‚›[Ù[˜[œÜÜ\ÜÚYÛ›Y[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆ\›RYİš[™ÈX\
\›WÚYŠBˆ›İ]RYİš[™ÈX\
œ›İ]WÚYŠBˆİÜYİš[™ÈX\
œİÜÚYŠBˆÜ™X]YHİš[™ÏÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ›İ]H˜[œÜÜ›İ]H™[][ÛŠšY[ÎˆÜ›İ]RYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
BˆİÜ˜[œÜÜİÜ™[][ÛŠšY[ÎˆÜİÜYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
B‚ˆ[š\]YJÜİY[Y\›RYJBˆ[™^
ÜØÚÛÛY›İ]RY\›RYJBˆX\
˜[œÜÜØ\ÜÚYÛ›Y[ÈŠBŸB‚‹ËÈ8¥ 8¥ 8¥ \ÙHHÈÔˆ8 %HXœ˜\H8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ ‹ËÈH›ÛÚË]È\ÚXØ[ÛÜY\È
XØÙ\ÜÚ[Ûˆ[X™\ˆ[š\]YH[ˆHØÚÛÛ
H[™‹ËÈØ[œÈÈHİY[ÔˆHY[X™\ˆÙˆİY™‹ˆÛ™HÜ[ˆØ[ˆ\ˆÛÜKHH\X[‹ËÈ[š\]YH[™^[ˆHZYÜ˜][Ûˆ
Xœ˜\WÛØ[œ×ÛÜ[—ØÛÜWÚÙ^JKˆš[™\È\™B‹ËÈİY[Ú\™Ù\È
ŒŠK™]™\ˆÜš][ˆ\™KˆØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌM‚‚™[[HXœ˜\PÛÜTİ]\ÈÂˆURSP“BˆÓ—ÓĞS‚ˆÔÕˆÒUUÓ‚ŸB‚›[Ù[Xœ˜\TÙ][™ÜÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™È[š\]YHX\
œØÚÛÛÚYŠBˆØ[‘^\È[Y˜][
M
HX\
›Ø[—Ù^\ÈŠBˆİY[[Z][Y˜][
ŠHX\
œİY[Û[Z]ŠBˆİY™“[Z][Y˜][
JHX\
œİY™—Û[Z]ŠBˆ™[™]Ø[[Z][Y˜][
ŠHX\
œ™[™]Ø[Û[Z]ŠBˆ™^XØÙ\ÜÚ[Ûˆ[Y˜][
JHX\
›™^ØXØÙ\ÜÚ[ÛˆŠBˆš[™\Ñ[˜X›Y›ÛÛX[ˆY˜][
˜[ÙJHX\
™š[™\×Ù[˜X›YŠHËÈÔ‹Œ‚ˆš[™T\‘^H[Y˜][

HX\
™š[™WÜ\—Ù^HŠHËÈÛØ›Âˆš[™QÜ˜XÙQ^\È[Y˜][

HX\
™š[™WÙÜ˜XÙWÙ^\ÈŠBˆš[™PØ\[ÈX\
™š[™WØØ\ŠHËÈÛØ›ÎÈ[ˆ›ÈØ\ˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠB‚ˆX\
›Xœ˜\WÜÙ][™ÜÈŠBŸB‚›[Ù[Xœ˜\P›ÛÚÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]Hİš[™Âˆ]]ÜœÈİš[™ÏÂˆ\Ø›ˆİš[™ÏÂˆX›\Ú\ˆİš[™ÏÂˆX›\ÚYYX\ˆ[ÈX\
œX›\ÚYŞYX\ˆŠBˆİXš™XİYİš[™ÏÈX\
œİXš™XİÚYŠBˆÚ[“ØØ][Ûˆİš[™ÏÈX\
œÚ[—ÛØØ][ÛˆŠBˆ™\XÙ[Y[šXÙH[ÈX\
œ™\XÙ[Y[ÜšXÙHŠHËÈÛØ›Âˆ™Y™\™[˜ÙSÛ›H›ÛÛX[ˆY˜][
˜[ÙJHX\
œ™Y™\™[˜ÙWÛÛ›HŠBˆÜ™X]YHİš[™ÏÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİXš™XİİXš™XİÈ™[][ÛŠšY[ÎˆÜİXš™XİYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
Bˆ]™[ÈXœ˜\P›ÛÚÓ]™[×BˆÛÜY\ÈXœ˜\PÛÜV×B‚ˆ[™^
ÜØÚÛÛY]WJBˆX\
›Xœ˜\WØ›ÛÚÜÈŠBŸB‚›[Ù[Xœ˜\P›ÛÚÓ]™[ÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ›ÛÚÒYİš[™ÈX\
˜›ÛÚ×ÚYŠBˆÛ\ÜÓ]™[Yİš[™ÈX\
˜Û\Ü×Û]™[ÚYŠBˆ›ÛÚÈXœ˜\P›ÛÚÈ™[][ÛŠšY[ÎˆØ›ÛÚÒYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆÛ\ÜÓ]™[Û\ÜÓ]™[™[][ÛŠšY[ÎˆØÛ\ÜÓ]™[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆY
Ø›ÛÚÒYÛ\ÜÓ]™[YJBˆ[™^
ÜØÚÛÛYJBˆX\
›Xœ˜\WØ›ÛÚ×Û]™[ÈŠBŸB‚›[Ù[Xœ˜\PÛÜHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ›ÛÚÒYİš[™ÈX\
˜›ÛÚ×ÚYŠBˆXØÙ\ÜÚ[Û“[X™\ˆİš[™ÈX\
˜XØÙ\ÜÚ[Û—Û[X™\ˆŠHËÈ\\ˆØ\ÙBˆİ]\ÈXœ˜\PÛÜTİ]\ÈY˜][
URSP“JBˆ›İHİš[™ÏÂˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ›ÛÚÈXœ˜\P›ÛÚÈ™[][ÛŠšY[ÎˆØ›ÛÚÒYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆØ[œÈXœ˜\SØ[–×B‚ˆ[š\]YJÜØÚÛÛYXØÙ\ÜÚ[Û“[X™\—JBˆ[™^
Ø›ÛÚÒYJBˆX\
›Xœ˜\WØÛÜY\ÈŠBŸB‚›[Ù[Xœ˜\SØ[ˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÛÜRYİš[™ÈX\
˜ÛÜWÚYŠBˆİY[Yİš[™ÏÈX\
œİY[ÚYŠHËÈ^XİHÛ™HÙˆİY[Y\Ù\’Yˆ\Ù\’Yİš[™ÏÈX\
\Ù\—ÚYŠBˆ\ÜİYY]]U[YHY˜][
›İÊ
JHX\
š\ÜİYYØ]ŠBˆYSÛˆ]U[YHX\
™YWÛÛˆŠH‹‘]Bˆ™[™]Ø[È[Y˜][

Bˆ™]\›™Y]]U[YOÈX\
œ™]\›™YØ]ŠBˆÜİ]]U[YOÈX\
›ÜİØ]ŠHËÈÔ‹ŒÈHÜİØ[ˆ\ÈÛÜÙYˆ›İ[™]]U[YOÈX\
™›İ[™Ø]ŠBˆš[™P[[İ[[ÈX\
™š[™WØ[[İ[ŠHËÈÛØ›ÎˆHš[™KÜˆH™\XÙ[Y[šXÙBˆš[™UØZ]™Y™X\ÛÛˆİš[™ÏÈX\
™š[™WİØZ]™YÜ™X\ÛÛˆŠBˆš[™UØZ]™YHİš[™ÏÈX\
™š[™WİØZ]™YØHŠBˆ\ÜİYYHİš[™ÏÈX\
š\ÜİYYØHŠBˆ™]\›™YHİš[™ÏÈX\
œ™]\›™YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆÛÜHXœ˜\PÛÜH™[][ÛŠšY[ÎˆØÛÜRYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
BˆİY[İY[È™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ\Ù\ˆ\Ù\È™[][ÛŠšY[Îˆİ\Ù\’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
ÜØÚÛÛY™]\›™Y]JBˆ[™^
ÜİY[YJBˆ[™^
İ\Ù\’YJBˆX\
›Xœ˜\WÛØ[œÈŠBŸB‚‹ËÈ\ÙHHÈÔ‹ŒÈ8 %YÚ][™\Ûİ\˜Ù\ÎˆHˆ
ŒKš]˜]JHÜˆ[ˆÈ[šÂ‹ËÈ›ÜˆÛ™HİXš™Xİ[™ÛÛYHÛ\ÜÈ]™[Ë™XYHİY[È[ˆÜÙH]™[Ë‚™[[HXœ˜\T™\Ûİ\˜ÙRÚ[™Âˆ’SBˆS’ÂŸB‚›[Ù[Xœ˜\T™\Ûİ\˜ÙHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]Hİš[™Âˆ\ØÜš\[Ûˆİš[™ÏÂˆİXš™XİYİš[™ÈX\
œİXš™XİÚYŠBˆÚ[™Xœ˜\T™\Ûİ\˜ÙRÚ[™ˆ\›İš[™ÏÈËÈS’ÈÛ›KÂˆš[Q^İš[™ÏÈX\
™š[WÙ^ŠHËÈ’SHÛ›Nˆœˆ‚ˆš[TÚ^™H[ÈX\
™š[WÜÚ^™HŠBˆYYHİš[™ÈX\
˜YYØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİXš™XİİXš™Xİ™[][ÛŠšY[ÎˆÜİXš™XİYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
Bˆ]™[ÈXœ˜\T™\Ûİ\˜ÙS]™[×B‚ˆ[™^
ÜØÚÛÛYİXš™XİYJBˆX\
›Xœ˜\WÜ™\Ûİ\˜Ù\ÈŠBŸB‚›[Ù[Xœ˜\T™\Ûİ\˜ÙS]™[ÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™\Ûİ\˜ÙRYİš[™ÈX\
œ™\Ûİ\˜ÙWÚYŠBˆÛ\ÜÓ]™[Yİš[™ÈX\
˜Û\Ü×Û]™[ÚYŠBˆ™\Ûİ\˜ÙHXœ˜\T™\Ûİ\˜ÙH™[][ÛŠšY[ÎˆÜ™\Ûİ\˜ÙRYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆÛ\ÜÓ]™[Û\ÜÓ]™[™[][ÛŠšY[ÎˆØÛ\ÜÓ]™[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆY
Ü™\Ûİ\˜ÙRYÛ\ÜÓ]™[YJBˆ[™^
ÜØÚÛÛYÛ\ÜÓ]™[YJBˆX\
›Xœ˜\WÜ™\Ûİ\˜ÙWÛ]™[ÈŠBŸB‚‹ËÈ8¥ 8¥ 8¥ \ÙHHÈÔ˜ˆ8 %Üİ[È[™›Ø\™[™È8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ 8¥ ‹ËÈHÜİ[\È›Üˆ›Ş\ÈÜˆÚ\›ËÚ]İ\ÙHX\İ\œÈ[™H™YH\ˆ\›H]‹ËÈİ[™È[[Ú[™ÙYˆHİY[ÛÈÛ™H™YH\›H
]XZÙ\È[HB‹ËÈ›Ø\™\ŠNÈH™YÛÈÛ™HİY[H\›KˆHÔÕSÚ\™ÙH\È˜Z\ÙY›İYÚ‹ËÈİY[Ú\™ÙTÙ\šXÙHÛ›KˆØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌMK‚‚™[[HÜİ[Ù[™\ˆÂˆ“ÖTÂˆÒT“ÂŸB‚›[Ù[Üİ[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜[YHİš[™Âˆ›Ü‘Ù[™\ˆÜİ[Ù[™\ˆX\
™›Ü—ÙÙ[™\ˆŠBˆ™YH[Y˜][

HËÈÛØ›È\ˆ\›NÈ\È›Û™BˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİ\ÙSX\İ\œÈÜİ[İ\ÙSX\İ\–×Bˆ›ÛÛ\ÈÜİ[›ÛÛV×Bˆ™YÈÜİ[™Y×Bˆš\Ú]ÈÜİ[š\Ú]×Bˆ^X]ÈÜİ[^X]×B‚ˆ[š\]YJÜØÚÛÛY˜[YWJBˆX\
šÜİ[ÈŠBŸB‚›[Ù[Üİ[İ\ÙSX\İ\ˆÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÜİ[Yİš[™ÈX\
šÜİ[ÚYŠBˆ\Ù\’Yİš[™ÈX\
\Ù\—ÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÜİ[Üİ[™[][ÛŠšY[ÎˆÚÜİ[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ\Ù\ˆ\Ù\ˆ™[][ÛŠšY[Îˆİ\Ù\’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆY
ÚÜİ[Y\Ù\’YJBˆ[™^
ÜØÚÛÛY\Ù\’YJBˆX\
šÜİ[Úİ\ÙWÛX\İ\œÈŠBŸB‚›[Ù[Üİ[›ÛÛHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÜİ[Yİš[™ÈX\
šÜİ[ÚYŠBˆ˜[YHİš[™Âˆ™YÈ[ˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆÜİ[Üİ[™[][ÛŠšY[ÎˆÚÜİ[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ[ØØ]YÜİ[™Y×B‚ˆ[š\]YJÚÜİ[Y˜[YWJBˆ[™^
ÜØÚÛÛYJBˆX\
šÜİ[Ü›ÛÛ\ÈŠBŸB‚›[Ù[Üİ[™YÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆ\›RYİš[™ÈX\
\›WÚYŠBˆÜİ[Yİš[™ÈX\
šÜİ[ÚYŠBˆ›ÛÛRYİš[™ÈX\
œ›ÛÛWÚYŠBˆ™Y[X™\ˆ[X\
˜™YÛ[X™\ˆŠBˆÜ™X]YHİš[™ÏÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆÜİ[Üİ[™[][ÛŠšY[ÎˆÚÜİ[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
Bˆ›ÛÛHÜİ[›ÛÛH™[][ÛŠšY[ÎˆÜ›ÛÛRYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
B‚ˆ[š\]YJÜİY[Y\›RYJBˆ[š\]YJÜ›ÛÛRY\›RY™Y[X™\—JBˆ[™^
ÜØÚÛÛYÜİ[Y\›RYJBˆX\
šÜİ[Ø™YÈŠBŸB‚‹ËÈ\ÙHHÈÔ˜‹Œˆ8 %Hš\Ú]ÜˆÙÈ
0©ÌMHÔ˜‹QJKˆİ\ÙHX\İ\ˆ[™YZ[‚‹ËÈÛ›NÈ\™[ÈÈ›İÙYH]
İÛ™\‹0©ÌMK
K‚›[Ù[Üİ[š\Ú]ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÜİ[Yİš[™ÈX\
šÜİ[ÚYŠBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆš\Ú]Ü“˜[YHİš[™ÈX\
š\Ú]Ü—Û˜[YHŠBˆ™[][ÛœÚ\İš[™ÂˆÛ™Hİš[™ÏÂˆ\œš]™Y]]U[YHX\
˜\œš]™YØ]ŠBˆY]]U[YOÈX\
›YØ]ŠBˆÙÙÙYHİš[™ÈX\
›ÙÙÙYØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÜİ[Üİ[™[][ÛŠšY[ÎˆÚÜİ[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
BˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
ÜØÚÛÛYÜİ[Y\œš]™Y]JBˆ[™^
ÜØÚÛÛYİY[YJBˆX\
šÜİ[İš\Ú]ÈŠBŸB‚™[[HÜİ[^X]İ]\ÈÂˆ‘TUQTÕQˆT“Õ‘Qˆ‘Q•TÑQˆÕUˆPÒÂˆĞSÑSQŸB‚‹ËÈ\ÙHHÈÔ˜‹ŒÈ8 %H›Ø\™\‰ÜÈX]™Hİ]
0©ÌMHÔ˜‹QŠKˆ\ÚÙYHH\™[Ü‚‹ËÈ[\™YHHØÚÛÛ
^XİHÛ™HÙˆHÛÈ™\]Y\İ\ˆÛÛ[[œÊNÈXÚYYB‹ËÈHİ\ÙHX\İ\ÈY[™˜XÚÈÙÙÙYÛˆH^K‚›[Ù[Üİ[^X]ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÜİ[Yİš[™ÈX\
šÜİ[ÚYŠBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆİ]]]U[YHX\
›İ]Ø]ŠBˆ˜XÚĞH]U[YHX\
˜˜XÚ×ØHŠBˆ™X\ÛÛˆİš[™ÂˆÛÛXİÜ“˜[YHİš[™ÈX\
˜ÛÛXİÜ—Û˜[YHŠBˆÛÛXİÜ”™[][ÛœÚ\İš[™ÈX\
˜ÛÛXİÜ—Ü™[][ÛœÚ\ŠBˆÛÛXİÜ”Û™Hİš[™ÈX\
˜ÛÛXİÜ—ÜÛ™HŠBˆİ]\ÈÜİ[^X]İ]\ÈY˜][
‘TUQTÕQ
Bˆ™\]Y\İYQİX\™X[’Yİš[™ÏÈX\
œ™\]Y\İYØWÙİX\™X[—ÚYŠBˆ™\]Y\İYU\Ù\’Yİš[™ÏÈX\
œ™\]Y\İYØWİ\Ù\—ÚYŠBˆXÚYYHİš[™ÏÈX\
™XÚYYØHŠBˆXÚYY]]U[YOÈX\
™XÚYYØ]ŠBˆXÚ\Ú[Û“›İHİš[™ÏÈX\
™XÚ\Ú[Û—Û›İHŠBˆY]]U[YOÈX\
›YØ]ŠBˆÛÛXİYHİš[™ÏÈX\
˜ÛÛXİYØHŠBˆ˜XÚĞ]]U[YOÈX\
˜˜XÚ×Ø]ŠBˆØ[˜Ù[Y]]U[YOÈX\
˜Ø[˜Ù[YØ]ŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆÜİ[Üİ[™[][ÛŠšY[ÎˆÚÜİ[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
BˆİY[İY[™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
ÜØÚÛÛYÜİ[Yİ]\×JBˆ[™^
ÜØÚÛÛYİY[YJBˆX\
šÜİ[Ù^X]ÈŠBŸB‚‹ËÈKKKKKKKKKH\ÙHHÈÔÈ8 %Û›[™HYZ\ÜÚ[Ûˆ\XØ][ÛœÈ
0©ÌM‹0©ÌM‹
HKKKKKKKKKB‚™[[HYZ\ÜÚ[Û”İ]\ÈÂˆÕP“RUQˆS‘T—Ô‘U’QUÂˆÑ‘‘T‘QˆÑ‘‘T—ĞPĞÑTQˆQRUQˆ‘R‘PÕQˆÒUUÓ‚ŸB‚‹ËÈÛ™H›İÈ\ˆØÚÛÛÜš][ˆÛˆš\œİØ]™Kˆ[[[ˆHY˜][È\K‹ËÈ[™\XØ][ÛœÈ\™HÔSˆ
İÛ™\‹0©ÌM‹
K‚›[Ù[YZ\ÜÚ[Û”Ù][™ÜÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™È[š\]YHX\
œØÚÛÛÚYŠBˆ[˜X›Y›ÛÛX[ˆY˜][
YJBˆ[›Èİš[™ÏÂˆÛ\Ğ[\È›ÛÛX[ˆY˜][
YJHX\
œÛ\×Ø[\ÈŠBˆ›İYQ[XZ[İš[™ÏÈX\
››İYWÙ[XZ[ŠBˆÙ™™\“]\ˆİš[™ÏÈX\
›Ù™™\—Û]\ˆŠBˆ›Ü›HœÛÛˆY˜][
ßHŠBˆÛÜÙYÛ\ÜÓ]™[YÈœÛÛˆY˜][
–×HŠHX\
˜ÛÜÙYØÛ\Ü×Û]™[ÚYÈŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠB‚ˆX\
˜YZ\ÜÚ[Û—ÜÙ][™ÜÈŠBŸB‚›[Ù[YZ\ÜÚ[Û\XØ][ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™Y™\™[˜ÙHİš[™ÂˆÛ\ÜÓ]™[Yİš[™ÈX\
˜Û\Ü×Û]™[ÚYŠBˆÚ[š\œİ˜[YHİš[™ÈX\
˜Ú[Ùš\œİÛ˜[YHŠBˆÚ[\İ˜[YHİš[™ÈX\
˜Ú[Û\İÛ˜[YHŠBˆ]SÙš\]U[YHX\
™]WÛÙ—Øš\ŠH‹‘]BˆÙ[™\ˆÙ[™\‚ˆİX\™X[‘š\œİ˜[YHİš[™ÈX\
™İX\™X[—Ùš\œİÛ˜[YHŠBˆİX\™X[“\İ˜[YHİš[™ÈX\
™İX\™X[—Û\İÛ˜[YHŠBˆİX\™X[”™[][ÛœÚ\™[][ÛœÚ\X\
™İX\™X[—Ü™[][ÛœÚ\ŠBˆİX\™X[”Û™Hİš[™ÈX\
™İX\™X[—ÜÛ™HŠBˆİX\™X[‘[XZ[İš[™ÈX\
™İX\™X[—Ù[XZ[ŠBˆ[œİÙ\œÈœÛÛˆY˜][
ßHŠBˆİ]\ÈYZ\ÜÚ[Û”İ]\ÈY˜][
ÕP“RUQ
Bˆİ]\ĞÚ[™ÙY]]U[YHY˜][
›İÊ
JHX\
œİ]\×ØÚ[™ÙYØ]ŠBˆÛÛœÙ[]]U[YHX\
˜ÛÛœÙ[Ø]ŠBˆÛÛœÙ[™\œÚ[Ûˆİš[™ÈX\
˜ÛÛœÙ[İ™\œÚ[ÛˆŠBˆ˜XÚÚ[™ÕÚÙ[’\Úİš[™È[š\]YHX\
˜XÚÚ[™×İÚÙ[—Ú\ÚŠBˆİY[Yİš[™ÏÈX\
œİY[ÚYŠBˆËËÈÔËŒˆS•SÑWÑVSKS•T•’QUËÓ“S‘HÜˆÕT‹Ú]]È[YH[™›İK‚ˆ\ÜÙ\ÜÛY[Ú[™İš[™ÏÈX\
˜\ÜÙ\ÜÛY[ÚÚ[™ŠBˆ\ÜÙ\ÜÛY[]]U[YOÈX\
˜\ÜÙ\ÜÛY[Ø]ŠBˆ\ÜÙ\ÜÛY[›İHİš[™ÏÈX\
˜\ÜÙ\ÜÛY[Û›İHŠBˆËËÈHÙ™™\ˆ]\ˆH˜[Z[HØ]Ë[ˆ[‚ˆÙ™™\“]\ˆİš[™ÏÈX\
›Ù™™\—Û]\ˆŠBˆÙ™™\™Y]]U[YOÈX\
›Ù™™\™YØ]ŠBˆXØÙ\Y]]U[YOÈX\
˜XØÙ\YØ]ŠBˆËËÈÚÈ™XÛÜ™YHXØÙ\[˜ÙNÈ•SYX[œÈH˜[Z[HXØÙ\YÛ›[™K‚ˆXØÙ\YU\Ù\’Yİš[™ÏÈX\
˜XØÙ\YØWİ\Ù\—ÚYŠBˆXÚ\Ú[Û“›İHİš[™ÏÈX\
™XÚ\Ú[Û—Û›İHŠBˆYZ]Y]]U[YOÈX\
˜YZ]YØ]ŠBˆYZ]YU\Ù\’Yİš[™ÏÈX\
˜YZ]YØWİ\Ù\—ÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆÛ\ÜÓ]™[Û\ÜÓ]™[™[][ÛŠšY[ÎˆØÛ\ÜÓ]™[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]Nˆ™\İšXİ
BˆİY[İY[È™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
BˆØİ[Y[ÈYZ\ÜÚ[Û‘Øİ[Y[×B‚ˆ[š\]YJÜØÚÛÛY™Y™\™[˜ÙWJBˆ[™^
ÜØÚÛÛYİ]\×JBˆ[™^
ÜØÚÛÛYİX\™X[‘[XZ[JBˆX\
˜YZ\ÜÚ[Û—Ø\XØ][ÛœÈŠBŸB‚›[Ù[YZ\ÜÚ[Û‘Øİ[Y[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ\XØ][Û’Yİš[™ÈX\
˜\XØ][Û—ÚYŠBˆÛİİš[™ÂˆX™[İš[™Âˆ^İš[™ÂˆÚ^™P]\È[X\
œÚ^™WØ]\ÈŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\XØ][ÛˆYZ\ÜÚ[Û\XØ][Ûˆ™[][ÛŠšY[ÎˆØ\XØ][Û’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[š\]YJØ\XØ][Û’YÛİJBˆX\
˜YZ\ÜÚ[Û—ÙØİ[Y[ÈŠBŸB‚›[Ù[YZ\ÜÚ[Û”™Y™\™[˜ÙPÛİ[\ˆÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆYX\ˆ[ˆ™^[Y˜][
JB‚ˆY
ÜØÚÛÛYYX\—JBˆX\
˜YZ\ÜÚ[Û—Ü™Y™\™[˜ÙWØÛİ[\œÈŠBŸB‚›[Ù[YZ\ÜÚ[Û”Û\ĞÛİ[\ˆÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ^H]U[YH‹‘]BˆÙ[[Y˜][

B‚ˆY
ÜØÚÛÛY^WJBˆX\
˜YZ\ÜÚ[Û—ÜÛ\×ØÛİ[\œÈŠBŸB‚‹ËÈ8¥ 8¥ 8¥ \ÙHHÈÔŒH8 %š]˜]HY\ÜØYÚ[™È
ØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌMË
H8¥ 8¥ ‹ËÈH\™[Üš]\ÈÈÓ‘H™XÚ\Y[X›İ]Û™HÚ[Üˆ[ˆÙ[™\˜[ÈÛ›H]‹ËÈ™XÚ\Y[[[Û™H]\È\ÜÙYÈ[™[[Û™HÚÈ\ÈÜš][ˆ[ˆ]ÙYH]‚‚™[[HY\ÜØYÙT™XÚ\Y[ÂˆÓTÔ×ÕPPÒT‚ˆ•T”ĞT‚ˆ’SÒTSˆPQÕPPÒT‚ˆQRS‚ˆÑ‘’PÑBŸB‚›[Ù[Y\ÜØYÙU™XYÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİX\™X[’Yİš[™ÈX\
™İX\™X[—ÚYŠBˆİY[Yİš[™ÏÈX\
œİY[ÚYŠBˆ™XÚ\Y[Y\ÜØYÙT™XÚ\Y[ˆËËÈHÛ\ÜÈXXÚ\ˆY™\ÜÙY›ÜˆÓTÔ×ÕPPÒTˆÛ›Kš^Y]Hİ\‚ˆ™XÚ\Y[\Ù\’Yİš[™ÏÈX\
œ™XÚ\Y[İ\Ù\—ÚYŠBˆİXš™Xİİš[™Âˆİ]\Èİš[™ÈY˜][
“ÔSˆŠBˆËËÈ•SˆHİX\™X[ˆİ\Y]Èİ\Ú\ÙHHÙ™šXÙHY[X™\ˆÚÈY‚ˆİ\YU\Ù\’Yİš[™ÏÈX\
œİ\YØWİ\Ù\—ÚYŠBˆ\İY\ÜØYÙP]]U[YHY˜][
›İÊ
JHX\
›\İÛY\ÜØYÙWØ]ŠBˆ\İY\ÜØYÙPHİš[™ÈX\
›\İÛY\ÜØYÙWØHŠBˆ[™YU\Ù\’Yİš[™ÏÈX\
š[™YØWİ\Ù\—ÚYŠBˆÛÜÙY]]U[YOÈX\
˜ÛÜÙYØ]ŠBˆÛÜÙYU\Ù\’Yİš[™ÏÈX\
˜ÛÜÙYØWİ\Ù\—ÚYŠBˆËËÈÔŒˆH™\ÜHİY™ˆ›YÈÜˆHØY™YİX\™[™ÈÛÜ™ˆÜ[œÈBˆËËÈÛÛ™\œØ][ÛˆÈİÛ™\ˆ[™YZ[œÈ[™ÙY\È][[ÛX\™Y‚ˆ›YÙÙY]]U[YOÈX\
™›YÙÙYØ]ŠBˆ›YÔ™X\ÛÛˆİš[™ÏÈX\
™›Y×Ü™X\ÛÛˆŠBˆ›YÓ›İHİš[™ÏÈX\
™›Y×Û›İHŠBˆ›YÙÙYRÚ[™İš[™ÏÈX\
™›YÙÙYØWÚÚ[™ŠBˆ›YÙÙYRYİš[™ÏÈX\
™›YÙÙYØWÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆİX\™X[ˆİX\™X[ˆ™[][ÛŠšY[ÎˆÙİX\™X[’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİY[İY[È™[][ÛŠšY[ÎˆÜİY[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
BˆY\ÜØYÙ\ÈY\ÜØYÙV×Bˆ\ÜÙ\ÈY\ÜØYÙT\ÜÖ×Bˆ™XYÈY\ÜØYÙT™XY×B‚ˆ[™^
ÜØÚÛÛYİ]\Ë\İY\ÜØYÙP]JBˆ[™^
ÜØÚÛÛYİX\™X[’YJBˆ[™^
ÜØÚÛÛY™XÚ\Y[JBˆ[™^
Ü™XÚ\Y[\Ù\’YJBˆ[™^
ÜØÚÛÛY›YÙÙY]JBˆX\
›Y\ÜØYÙWİ™XYÈŠBŸB‚›[Ù[Y\ÜØYÙT\ÜÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™XYYİš[™ÈX\
™XYÚYŠBˆ™XÚ\Y[Y\ÜØYÙT™XÚ\Y[ˆ™XÚ\Y[\Ù\’Yİš[™ÏÈX\
œ™XÚ\Y[İ\Ù\—ÚYŠBˆ\ÜÙYU\Ù\’Yİš[™ÈX\
œ\ÜÙYØWİ\Ù\—ÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ™XYY\ÜØYÙU™XY™[][ÛŠšY[Îˆİ™XYYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
İ™XYYJBˆ[™^
ÜØÚÛÛY™XÚ\Y[JBˆX\
›Y\ÜØYÙWÜ\ÜÙ\ÈŠBŸB‚›[Ù[Y\ÜØYÙHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™XYYİš[™ÈX\
™XYÚYŠBˆ]]Ü’Ú[™İš[™ÈX\
˜]]Ü—ÚÚ[™ŠBˆİX\™X[’Yİš[™ÏÈX\
™İX\™X[—ÚYŠBˆ\Ù\’Yİš[™ÏÈX\
\Ù\—ÚYŠBˆËËÈ›ÜˆHİY™ˆY\ÜØYÙKH™XÚ\Y[HÜš]\ˆ[œİÙ\™Y\Ë‚ˆ\Ô™XÚ\Y[Y\ÜØYÙT™XÚ\Y[ÈX\
˜\×Ü™XÚ\Y[ŠBˆ›ÙHİš[™ÂˆËËÈÔŒˆH^X]ÚYHØY™YİX\™[™ÈÛÜ™‚ˆØY™YİX\™[™ÓX]Ú›ÛÛX[ˆY˜][
˜[ÙJHX\
œØY™YİX\™[™×ÛX]ÚŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ™XYY\ÜØYÙU™XY™[][ÛŠšY[Îˆİ™XYYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ[XYÙ\ÈY\ÜØYÙR[XYÙV×B‚ˆ[™^
İ™XYYÜ™X]Y]JBˆ[™^
ÜØÚÛÛYİX\™X[’YÜ™X]Y]JBˆX\
›Y\ÜØYÙ\ÈŠBŸB‚›[Ù[Y\ÜØYÙT™XYÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™XYYİš[™ÈX\
™XYÚYŠBˆ™XY\’Ú[™İš[™ÈX\
œ™XY\—ÚÚ[™ŠBˆ™XY\’Yİš[™ÈX\
œ™XY\—ÚYŠBˆ\İ™XY]]U[YHX\
›\İÜ™XYØ]ŠBˆ™XYY\ÜØYÙU™XY™[][ÛŠšY[Îˆİ™XYYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆY
İ™XYY™XY\’Ú[™™XY\’YJBˆX\
›Y\ÜØYÙWÜ™XYÈŠBŸB‚›[Ù[Y\ÜØYÙTÛ\ĞÛİ[\ˆÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ^H]U[YH‹‘]BˆÙ[[Y˜][

B‚ˆY
ÜØÚÛÛY^WJBˆX\
›Y\ÜØYÙWÜÛ\×ØÛİ[\œÈŠBŸB‚‹ËËÈÔŒˆ[ˆ[XYÙHÛˆHY\ÜØYÙKˆİYÙY
›ÈY\ÜØYÙJH[[HY\ÜØYÙH\ÈÙ[‚›[Ù[Y\ÜØYÙR[XYÙHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆY\ÜØYÙRYİš[™ÏÈX\
›Y\ÜØYÙWÚYŠBˆ\ØY\’Ú[™İš[™ÈX\
\ØY\—ÚÚ[™ŠBˆ\ØY\’Yİš[™ÈX\
\ØY\—ÚYŠBˆ^İš[™ÂˆÚ^™P]\È[X\
œÚ^™WØ]\ÈŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆY\ÜØYÙHY\ÜØYÙOÈ™[][ÛŠšY[ÎˆÛY\ÜØYÙRYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
ÛY\ÜØYÙRYJBˆ[™^
ÜØÚÛÛY\ØY\’Ú[™\ØY\’YJBˆX\
›Y\ÜØYÙWÚ[XYÙ\ÈŠBŸB‚‹ËÈ\ÙHHÈÔŒÈ8 %Û™H[››İ[˜Ù[Y[[XZ[ÈÛ™HY™\ÜÂ‹ËÈ
ØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌMËŒLJKˆÛZ[YYÛ˜ÙH
UQUQQ8¡¤ˆÑS‘S‘ÊKÛÈB‹ËÈ™]šYY›Øˆ™]™\ˆÙ[™ÈÚXÙKˆÙXšÛÚÈ]™[È[İ™HÑS•ÈSU‘T‘Q‹ËÈ“ÕSÑQÜˆÓÓTRS‘Q‚›[Ù[[››İ[˜Ù[Y[[XZ[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ[››İ[˜Ù[Y[Yİš[™ÈX\
˜[››İ[˜Ù[Y[ÚYŠBˆİX\™X[’Yİš[™ÏÈX\
™İX\™X[—ÚYŠBˆ[XZ[İš[™Âˆİ]\Èİš[™ÂˆÚÚ\™X\ÛÛˆİš[™ÏÈX\
œÚÚ\Ü™X\ÛÛˆŠBˆ›İšY\’Yİš[™ÏÈ[š\]YHX\
œ›İšY\—ÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÙ[]]U[YOÈX\
œÙ[Ø]ŠBˆ\]Y]]U[YHY˜][
›İÊ
JH\]Y]X\
\]YØ]ŠBˆ[››İ[˜Ù[Y[[››İ[˜Ù[Y[™[][ÛŠšY[ÎˆØ[››İ[˜Ù[Y[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİX\™X[ˆİX\™X[È™[][ÛŠšY[ÎˆÙİX\™X[’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
B‚ˆ[š\]YJØ[››İ[˜Ù[Y[Y[XZ[JBˆ[™^
ÜØÚÛÛY[››İ[˜Ù[Y[Yİ]\×JBˆX\
˜[››İ[˜Ù[Y[Ù[XZ[ÈŠBŸB‚‹ËÈ[ˆY™\ÜÈ]Ù]È›È[Ü™H[››İ[˜Ù[Y[[XZ[È
S““ÕSÑSQS•Îˆ]‹ËÈ[œİXœØÜšX™Y
HÜˆ›È›Û‹Y\ÜÙ[X[[XZ[][
SˆH\™›İ[˜ÙHÜˆB‹ËÈÛÛ\Z[
Kœ›ÛHÛ™HØÚÛÛ‚›[Ù[[XZ[İ\™\ÜÚ[ÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ[XZ[İš[™Âˆ™X\ÛÛˆİš[™ÂˆØÛÜHİš[™ÂˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ[š\]YJÜØÚÛÛY[XZ[ØÛÜWJBˆX\
™[XZ[Üİ\™\ÜÚ[ÛœÈŠBŸB‚‹ËÈ[››İ[˜Ù[Y[[XZ[ÈHØÚÛÛ\ÈÙ[[ˆHYÛÜÈ^KYØZ[œİ]È[‰ÜÈ[Z]‚›[Ù[[››İ[˜Ù[Y[[XZ[Ûİ[\ˆÂˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ^H]U[YH‹‘]BˆÙ[[Y˜][

B‚ˆY
ÜØÚÛÛY^WJBˆX\
˜[››İ[˜Ù[Y[Ù[XZ[ØÛİ[\œÈŠBŸB‚‹ËÈ\ÙHHÈÔLŒH8 %Û™H\™[	ÜÈ[œİÙ\ˆÈ[ˆ]™[
ØÜËÛ[Ù[\ËÜ\ÙKNK›Y0©ÌNKŒŠK‚›[Ù[]™[œİœÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]™[Yİš[™ÈX\
™]™[ÚYŠBˆİX\™X[’Yİš[™ÈX\
™İX\™X[—ÚYŠBˆ[œİÙ\ˆİš[™Âˆ][™[™È[ÂˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YHY˜][
›İÊ
JH\]Y]X\
\]YØ]ŠBˆ]™[ØÚÛÛ]™[™[][ÛŠšY[ÎˆÙ]™[YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆİX\™X[ˆİX\™X[ˆ™[][ÛŠšY[ÎˆÙİX\™X[’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[š\]YJÙ]™[YİX\™X[’YJBˆ[™^
ÜØÚÛÛY]™[YJBˆX\
™]™[ÜœİœÈŠBŸB‚‹ËÈKKKKKKKKKHQØ\™È
Œ‹LLLNKØÜËÛ[Ù[\ËÚYXØ\™ËX[™\İÜ™K›Y0©ÌÊHKKKKKKKKKB‚™[[HYØ\™Û\’Ú[™ÂˆÕQS•ˆÕQ‘‚ŸB‚™[[HYØ\™İ]\ÈÂˆPÕU‘BˆĞSÑSQˆ‘TPÑQŸB‚‹ËÈÛ™H›İÈ\ˆØ\™\ÜİYYˆ™Z\ÜİZ[™ÈX\šÜÈHÛ›İÈ‘TPÑQˆZ[ˆ’ÜË‚›[Ù[YØ\™ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÛ\’Ú[™YØ\™Û\’Ú[™X\
šÛ\—ÚÚ[™ŠBˆİY[Yİš[™ÏÈX\
œİY[ÚYŠBˆ\Ù\’Yİš[™ÏÈX\
\Ù\—ÚYŠBˆXØY[ZXÖYX\’Yİš[™ÈX\
˜XØY[ZX×ŞYX\—ÚYŠBˆØ\™[X™\ˆİš[™ÈX\
˜Ø\™Û[X™\ˆŠBˆİ]\ÈYØ\™İ]\ÈY˜][
PÕU‘JBˆ\ÜİYYHİš[™ÈX\
š\ÜİYYØHŠBˆ\ÜİYY]]U[YHY˜][
›İÊ
JHX\
š\ÜİYYØ]ŠBˆ[™Y]]U[YOÈX\
™[™YØ]ŠBˆ[™YHİš[™ÏÈX\
™[™YØHŠBˆ[™™X\ÛÛˆİš[™ÏÈX\
™[™Ü™X\ÛÛˆŠBˆ™\XÙYRYİš[™ÏÈX\
œ™\XÙYØWÚYŠB‚ˆ[š\]YJÜØÚÛÛYØ\™[X™\—JBˆ[™^
ÜØÚÛÛYXØY[ZXÖYX\’YJBˆ[™^
ÜİY[YJBˆ[™^
İ\Ù\’YJBˆX\
šYØØ\™ÈŠBŸB‚‹ËÈKKKKKKKKKHHİÜ™H[™š^Y\ÜÙ]È
Œ‹LLLNKØÜËÛ[Ù[\ËÚYXØ\™ËX[™\İÜ™K›Y0©Í
HKKKKKKKKKB‚™[[HİÜ™PØ]YÛÜHÂˆS’Q“Ô“BˆV“ÓÒÂˆÕUSÓ‘T–BˆP“ÔUÔ–BˆÔÔ•ÂˆPÕˆÓPS’S‘ÂˆÒUÒS‚ˆÕT‚ŸB‚™[[HİÜ™S[İ™[Y[Ú[™Âˆ‘PÑRU‘BˆTÔÕQBˆÑSˆ‘UT“‚ˆÔ’UWÓÑ‘‚ˆQ•TÕŸB‚™[[HİÜ™TİØÚÕZÙTİ]\ÈÂˆÔS‚ˆÕP“RUQˆT“Õ‘QˆĞSÑSQŸB‚™[[Hš^Y\ÜÙ]Ø]YÛÜHÂˆPÕˆ•T“’UT‘BˆP“ÔUÔ–BˆÔÔ•ÂˆUQS×Õ’TÕPSˆ‘RPÓBˆÒUÒS‚ˆ•RSS‘ÂˆÕT‚ŸB‚™[[Hš^Y\ÜÙ]ÛÛ™][ÛˆÂˆ‘UÂˆÓÓÑˆRT‚ˆÓÔ‚ˆ”“ÒÑS‚ŸB‚™[[Hš^Y\ÜÙ]İ]\ÈÂˆS—ÕTÑBˆS—ÔÕÔ‘BˆS‘T—Ô‘TRT‚ˆTÔÔÑQŸB‚™[[Hš^Y\ÜÙ]]™[Ú[™ÂˆQQˆSÕ‘QˆTÔÒQÓ‘QˆÓÓ‘USÓ‚ˆÕUTÂˆQUQŸB‚‹ËÈÚ]HİÜ™HÛËˆİØÚÈ\ÈÙ\\ˆ˜\šX[
HÚ^™KÜˆÛ™H[›˜[YY
K‚‹ËÈHÛÙH\È[š\]YH\ˆØÚÛÛYÛ›Üš[™ÈØ\ÙH
[ˆ^™\ÜÚ[Ûˆ[™^[ˆÔS
K‚›[Ù[İÜ™R][HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜[YHİš[™ÂˆÛÙHİš[™ÏÂˆØ]YÛÜHİÜ™PØ]YÛÜBˆ[š]İš[™ÈY˜][
œYXÙHŠBˆ™[Ü™\“]™[[Y˜][

HX\
œ™[Ü™\—Û]™[ŠBˆÙ[šXÙH[ÈX\
œÙ[ÜšXÙHŠHËÈÛØ›Âˆ›İ\Èİš[™ÏÂˆ\ĞXİ]™H›ÛÛX[ˆY˜][
YJHX\
š\×ØXİ]™HŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠB‚ˆ˜\šX[ÈİÜ™R][U˜\šX[×Bˆ[İ™[Y[ÈİÜ™S[İ™[Y[×BˆXÚÒ][\ÈİÜ™TXÚÒ][V×BˆÜ™\“[™\ÈİÜ™SÜ™\“[™V×B‚ˆ[š\]YJÜØÚÛÛYYJBˆX\
œİÜ™WÚ][\ÈŠBŸB‚›[Ù[İÜ™R][U˜\šX[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ][RYİš[™ÈX\
š][WÚYŠBˆX™[İš[™ÏÂˆÙ[šXÙH[ÈX\
œÙ[ÜšXÙHŠHËÈÛØ›Ëİ™\œšY\ÈH][IÜÂˆ\ĞXİ]™H›ÛÛX[ˆY˜][
YJHX\
š\×ØXİ]™HŠBˆÛÜÜ™\ˆ[Y˜][

HX\
œÛÜÛÜ™\ˆŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ][HİÜ™R][H™[][ÛŠšY[ÎˆÜØÚÛÛY][RYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJBˆ[İ™[Y[ÈİÜ™S[İ™[Y[×BˆİØÚÕZÙT›İÜÈİÜ™TİØÚÕZÙS[™V×BˆÜ™\“[™\ÈİÜ™SÜ™\“[™V×B‚ˆ[š\]YJÜØÚÛÛYYJBˆX\
œİÜ™WÚ][Wİ˜\šX[ÈŠBŸB‚‹ËÈHYÙ\ˆ\[™[Û›H
HšYÙÙ\ˆ™Y\Ù\ÈTUH[™SUJK‚›[Ù[İÜ™S[İ™[Y[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜\šX[Yİš[™ÈX\
˜\šX[ÚYŠBˆ][RYİš[™ÈX\
š][WÚYŠBˆÚ[™İÜ™S[İ™[Y[Ú[™ˆ]X[]H[ËÈÚYÛ™Yˆ
È[‹Hİ]ˆ[š]ÛÜİ[ÈX\
[š]ØÛÜİŠHËÈÛØ›Âˆ[š]šXÙH[ÈX\
[š]ÜšXÙHŠHËÈÛØ›ÂˆİY[Yİš[™ÏÈX\
œİY[ÚYŠBˆ\Ù\’Yİš[™ÏÈX\
\Ù\—ÚYŠBˆ\\Y[İš[™ÏÂˆİ\Y\ˆİš[™ÏÂˆ™Y™\™[˜ÙHİš[™ÏÂˆ™X\ÛÛˆİš[™ÏÂˆİY[Ú\™ÙRYİš[™ÏÈX\
œİY[ØÚ\™ÙWÚYŠBˆİØÚÕZÙRYİš[™ÏÈX\
œİØÚ×İZÙWÚYŠBˆËÈİÜ™HÜ™\œÈ
Œ‹LLKLLJNˆHÜ™\ˆ[™H\È[™[İ™\ˆ™[Û™ÜÈË‚ˆÜ™\“[™RYİš[™ÏÈX\
›Ü™\—Û[™WÚYŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ˜\šX[İÜ™R][U˜\šX[™[][ÛŠšY[ÎˆÜØÚÛÛY˜\šX[YK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆ][HİÜ™R][H™[][ÛŠšY[ÎˆÜØÚÛÛY][RYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆÜ™\“[™HİÜ™SÜ™\“[™OÈ™[][ÛŠšY[ÎˆÜØÚÛÛYÜ™\“[™RYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJB‚ˆ[™^
İ˜\šX[YJBˆ[™^
ÛÜ™\“[™RYJBˆ[™^
ÜØÚÛÛYÜ™X]Y]JBˆ[™^
ÜİY[YJBˆX\
œİÜ™WÛ[İ™[Y[ÈŠBŸB‚›[Ù[İÜ™TİØÚÕZÙHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİ]\ÈİÜ™TİØÚÕZÙTİ]\ÈY˜][
ÔSŠBˆ›İHİš[™ÏÂˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆİX›Z]YHİš[™ÏÈX\
œİX›Z]YØHŠBˆİX›Z]Y]]U[YOÈX\
œİX›Z]YØ]ŠBˆXÚYYHİš[™ÏÈX\
™XÚYYØHŠBˆXÚYY]]U[YOÈX\
™XÚYYØ]ŠB‚ˆ[™\ÈİÜ™TİØÚÕZÙS[™V×B‚ˆ[š\]YJÜØÚÛÛYYJBˆX\
œİÜ™WÜİØÚ×İZÙ\ÈŠBŸB‚›[Ù[İÜ™TİØÚÕZÙS[™HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİØÚÕZÙRYİš[™ÈX\
œİØÚ×İZÙWÚYŠBˆ˜\šX[Yİš[™ÈX\
˜\šX[ÚYŠBˆ^XİY[ÂˆÛİ[Y[Â‚ˆİØÚÕZÙHİÜ™TİØÚÕZÙH™[][ÛŠšY[ÎˆÜØÚÛÛYİØÚÕZÙRYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJBˆ˜\šX[İÜ™R][U˜\šX[™[][ÛŠšY[ÎˆÜØÚÛÛY˜\šX[YK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJB‚ˆ[š\]YJÜİØÚÕZÙRY˜\šX[YJBˆX\
œİÜ™WÜİØÚ×İZÙWÛ[™\ÈŠBŸB‚›[Ù[š^Y\ÜÙ]ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆYÈİš[™Âˆ˜[YHİš[™ÂˆØ]YÛÜHš^Y\ÜÙ]Ø]YÛÜBˆØØ][Ûˆİš[™ÏÂˆ\ÜÚYÛ™YÕ\Ù\’Yİš[™ÏÈX\
˜\ÜÚYÛ™Yİ×İ\Ù\—ÚYŠBˆ\ÜÚYÛ™YÕ^İš[™ÏÈX\
˜\ÜÚYÛ™Yİ×İ^ŠBˆÛÛ™][Ûˆš^Y\ÜÙ]ÛÛ™][ÛˆY˜][
ÓÓÑ
Bˆİ]\Èš^Y\ÜÙ]İ]\ÈY˜][
S—ÕTÑJBˆÙ\šX[[X™\ˆİš[™ÏÈX\
œÙ\šX[Û[X™\ˆŠBˆİ\Y\ˆİš[™ÏÂˆ\˜Ú\ÙQ]H]U[YOÈX\
œ\˜Ú\ÙWÙ]HŠH‹‘]Bˆ\˜Ú\ÙPÛÜİ[ÈX\
œ\˜Ú\ÙWØÛÜİŠHËÈÛØ›Âˆ›İ\Èİš[™ÏÂˆ\ÜÜÙY]]U[YOÈX\
™\ÜÜÙYØ]ŠH‹‘]Bˆ\ÜÜØ[™X\ÛÛˆİš[™ÏÈX\
™\ÜÜØ[Ü™X\ÛÛˆŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠB‚ˆ]™[Èš^Y\ÜÙ]]™[×B‚ˆ[š\]YJÜØÚÛÛYYJBˆX\
™š^YØ\ÜÙ]ÈŠBŸB‚›[Ù[š^Y\ÜÙ]]™[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ\ÜÙ]Yİš[™ÈX\
˜\ÜÙ]ÚYŠBˆÚ[™š^Y\ÜÙ]]™[Ú[™ˆœ›ÛU˜[YHİš[™ÏÈX\
™œ›ÛWİ˜[YHŠBˆÕ˜[YHİš[™ÏÈX\
×İ˜[YHŠBˆ›İHİš[™ÏÂˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆ\ÜÙ]š^Y\ÜÙ]™[][ÛŠšY[ÎˆÜØÚÛÛY\ÜÙ]YK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
Ø\ÜÙ]YÜ™X]Y]JBˆX\
™š^YØ\ÜÙ]Ù]™[ÈŠBŸB‚‹ËÈ8¥ 8¥ 8¥ HØÚÛÛ	ÜÈX›XÈÙXœÚ]H
Œ‹LLLŒ‹ØÜËÛ[Ù[\ËÜØÚÛÛ]ÙXœÚ]K›Y
B‚‹ËÈÛ™H›İÈ\ˆØÚÛÛˆHYÙH]Z[È\ÈHY]Üˆ\İØ]™Y[H
˜Y
B‹ËÈ[™\È˜[Z[Y\ÈÙYH[H
X›\ÚY
Kˆ›İ\™HHÚXÚÙYÚ\HÙ‚‹ËÈÙXœÚ]Q]Z[ÔØÚ[XH[ˆØÚÛÛZÚ]İ\\Ë‚›[Ù[ØÚÛÛÙXœÚ]HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™È[š\]YHX\
œØÚÛÛÚYŠBˆ˜YœÛÛˆY˜][
ßHŠBˆX›\ÚYœÛÛÂˆX›\ÚY]]U[YOÈX\
œX›\ÚYØ]ŠBˆX›\ÚYHİš[™ÏÈX\
œX›\ÚYØHŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆ\]YHİš[™ÏÈX\
\]YØHŠB‚ˆX\
œØÚÛÛİÙXœÚ]\ÈŠBŸB‚™[[HÙXœÚ]TÜİİ]\ÈÂˆQ•ˆP“TÒQ‚ˆX\
ÙXœÚ]WÜÜİÜİ]\ÈŠBŸB‚‹ËÈ™]ÜÈÜİÎˆX›XÈÛ›K™]™\ˆÙ[ÈÛ™\È
[››İ[˜Ù[Y[ÈÈ]
K‚›[Ù[ØÚÛÛÙXœÚ]TÜİÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]Hİš[™Âˆ›ÙHİš[™Âˆİ]\ÈÙXœÚ]TÜİİ]\ÈY˜][
Q•
BˆX›\ÚY]]U[YOÈX\
œX›\ÚYØ]ŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠBˆËÈØÚÛÛÚ]	ÜÈZÙKYİÛˆY[‹[™HØÚÛÛØ[››İ™\X›\Ú]‚ˆZÙ[‘İÛ]]U[YOÈX\
ZÙ[—ÙİÛ—Ø]ŠBˆZÙ[‘İÛHİš[™ÏÈX\
ZÙ[—ÙİÛ—ØHŠBˆZÙQİÛ”™X\ÛÛˆİš[™ÏÈX\
ZÙWÙİÛ—Ü™X\ÛÛˆŠB‚ˆİÜÈØÚÛÛÙXœÚ]TİÖ×B‚ˆ[™^
ÜØÚÛÛYİ]\ËX›\ÚY]JBˆX\
œØÚÛÛİÙXœÚ]WÜÜİÈŠBŸB‚›[Ù[ØÚÛÛÙXœÚ]P[[HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ]Hİš[™ÂˆÜÚ][Ûˆ[Y˜][

BˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆİÜÈØÚÛÛÙXœÚ]TİÖ×B‚ˆ[™^
ÜØÚÛÛYJBˆX\
œØÚÛÛİÙXœÚ]WØ[[\ÈŠBŸB‚™[[HÙXœÚ]TİÒÚ[™ÂˆÓÕ‘T‚ˆÔÕˆĞST–BˆPQT‚‚ˆX\
ÙXœÚ]WÜİ×ÚÚ[™ŠBŸB‚‹ËÈ]™\HİÈÛˆHÙXœÚ]KˆÛÈ”QÜÈ[ˆİÜ˜YÙH
\™ÙK[XŠKˆB‹ËÈ\ØY\‰ÜÈ•\ÈİÈÚİÜÈ›È\[ÈˆXÚÈ\È™XÛÜ™YÚ]ÚÈØ]™H]‹ËÈ
Íˆ›È\[ÈÛˆX›XÈYÙ\ÊNÈ\™H\È›ÈİÈÚ]İ]Û™K‚›[Ù[ØÚÛÛÙXœÚ]TİÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÚ[™ÙXœÚ]TİÒÚ[™ˆÜİYİš[™ÏÈX\
œÜİÚYŠBˆ[[RYİš[™ÏÈX\
˜[[WÚYŠBˆØ\[Ûˆİš[™ÏÂˆÜÚ][Ûˆ[Y˜][

Bˆ›Ô\[ĞÛÛ™š\›YYHİš[™ÈX\
››×Ü\[×ØÛÛ™š\›YYØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆZÙ[‘İÛ]]U[YOÈX\
ZÙ[—ÙİÛ—Ø]ŠBˆZÙ[‘İÛHİš[™ÏÈX\
ZÙ[—ÙİÛ—ØHŠBˆZÙQİÛ”™X\ÛÛˆİš[™ÏÈX\
ZÙWÙİÛ—Ü™X\ÛÛˆŠB‚ˆÜİØÚÛÛÙXœÚ]TÜİÈ™[][ÛŠšY[ÎˆÜÜİYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ[[HØÚÛÛÙXœÚ]P[[OÈ™[][ÛŠšY[ÎˆØ[[RYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆÙ][
B‚ˆ[™^
ÜØÚÛÛYÚ[™JBˆ[™^
ÜÜİYJBˆX\
œØÚÛÛİÙXœÚ]WÜİÜÈŠBŸB‚‹ËÈ”™\Ü\ÈİÈˆœ›ÛHHX›XÈYÙKˆ™XYHØÚÛÛÚ]	ÜÈÜ\˜]Ü‹‚›[Ù[ØÚÛÛÙXœÚ]T™\ÜÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİÒYİš[™ÏÈX\
œİ×ÚYŠBˆÜİYİš[™ÏÈX\
œÜİÚYŠBˆ™X\ÛÛˆİš[™ÂˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ™\ÛÛ™Y]]U[YOÈX\
œ™\ÛÛ™YØ]ŠBˆ™\ÛÛ™YHİš[™ÏÈX\
œ™\ÛÛ™YØHŠBˆËÈRÑS—ÑÕÓˆÜˆTÓRTÔÑQ‚ˆ™\ÛÛ][Ûˆİš[™ÏÂ‚ˆ[™^
ÜØÚÛÛY™\ÛÛ™Y]JBˆX\
œØÚÛÛİÙXœÚ]WÜ™\ÜÈŠBŸB‚‹ËÈH™\]Y\İœ›ÛHH\È[]HH\œÛÛ‰ÜÈXØÛİ[
Œ‹LLL
KˆH\‹ËÈİÜ™\È™YYÛ™NÈ[][™È\ÈHØÚÛÛ	ÜÈØ[™XØ]\ÙHHØÚÛÛÛÂ‹ËÈH™XÛÜ™ËÛÈ\ÈÛ›H[ÈHØÚÛÛˆÛ™HÜ[ˆ™\]Y\İ\ˆ\œÛÛ‹‚›[Ù[XØÛİ[[][Û”™\]Y\İÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆËÈÕQ‘‹ÕPT‘PSˆÜˆÕQS•
ÒPÒÈ[ˆHZYÜ˜][ÛŠK‚ˆš[˜Ú\[İš[™ÂˆËÈ\Ù\œËšYİX\™X[œËšYÜˆİY[ËšYHš[˜Ú\[‚ˆİXš™XİYİš[™ÈX\
œİXš™XİÚYŠBˆ™\]Y\İY]]U[YHY˜][
›İÊ
JHX\
œ™\]Y\İYØ]ŠBˆ[™Y]]U[YOÈX\
š[™YØ]ŠBˆ[™YHİš[™ÏÈX\
š[™YØHŠB‚ˆ[™^
ÜØÚÛÛY[™Y]JBˆX\
˜XØÛİ[Ù[][Û—Ü™\]Y\İÈŠBŸB‚‹ËÈHØÚÛÛ	ÜÈ™\]Y\İ›ÜˆHÙ]\Ø[Ú]HØÚÛÛÚ]X[H
Œ‹LLL‹‹ËÈØÜËÛ[Ù[\ËÛÛ˜›Ø\™[™ËXØ[›Y
Kˆ›ÛÚÙYœ›ÛHHYÙHÚİÛˆY\ˆHÙ]\‹ËÈÚ^˜\™ÈHX[HÛÛ™š\›\ÈH[YHÛˆÚ]Ğ\[™X\šÜÈ]Û™H[ˆB‹ËÈ]›Ü›HYZ[‹‚›[Ù[Û˜›Ø\™[™ĞØ[›ÛÚÚ[™ÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ›ÛÚÙYHİš[™ÈX\
˜›ÛÚÙYØHŠBˆËÈH^KYÛÜÈ[YK[™Hİ\\ÈZ[]\ÈÚ[˜ÙHZYšYÚ
ÓUQK›Y‚ˆËÈ[YHÙˆ^H\È[ˆ[™]™\ˆ‹•[YJK‚ˆØ[]H]U[YHX\
˜Ø[Ù]HŠH‹‘]Bˆİ\Z[]H[X\
œİ\ÛZ[]HŠBˆÛÛXİ˜[YHİš[™ÈX\
˜ÛÛXİÛ˜[YHŠBˆÛÛXİÛ™Hİš[™ÈX\
˜ÛÛXİÜÛ™HŠBˆ›İHİš[™ÏÂˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÛ™P]]U[YOÈX\
™Û™WØ]ŠB‚ˆ[™^
ÜØÚÛÛYÜ™X]Y]JBˆX\
›Û˜›Ø\™[™×ØØ[Ø›ÛÚÚ[™ÜÈŠBŸB‚‹ËÈÙ][™Èİ\Y
Œ‹LLLÌØÜËÛ[Ù[\ËØXİ]˜][Û‹›Y
NˆHÙ]\™[Z[™\‚‹ËÈÙ[ÈHØÚÛÛ	ÜÈİÛ™\‹][ÜİÛ™HÙˆXXÚÚ[™ˆİ]\È\È™\Ù[™	ÜÂ‹ËÈ
ÑS•[ˆSU‘T‘Q“ÕSÑQÜˆÓÓTRS‘QÈRSQÚ[ˆHÙ[™]Ù[‚‹ËÈ˜Z[Y
KˆÛXÚÜÈ\™HÛİ[YHHTIÜÈİÛˆ™Y\™XİˆİYÙP]Ù[™
KMŠH\Â‹ËÈHØÚÛÛ	ÜÈİYÙHÚ[ˆ]Ù[ÈÚİÈÚ]\ˆ][İ™YÛˆY\Ø\™Ë‚›[Ù[Xİ]˜][Û‘[XZ[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÚ[™İš[™ÂˆÑ[XZ[İš[™ÈX\
×Ù[XZ[ŠBˆ›İšY\’Yİš[™ÏÈX\
œ›İšY\—ÚYŠBˆİYÙP]Ù[™[X\
œİYÙWØ]ÜÙ[™ŠBˆİ]\Èİš[™ÈY˜][
”ÑS•ŠBˆÙ[]]U[YHY˜][
›İÊ
JHX\
œÙ[Ø]ŠBˆ[]™\™Y]]U[YOÈX\
™[]™\™YØ]ŠBˆš\œİÛXÚÙY]]U[YOÈX\
™š\œİØÛXÚÙYØ]ŠBˆÛXÚĞÛİ[[Y˜][

HX\
˜ÛXÚ×ØÛİ[ŠB‚ˆ[š\]YJÜØÚÛÛYÚ[™JBˆ[™^
ÜØÚÛÛY›İšY\’YJBˆX\
˜Xİ]˜][Û—Ù[XZ[ÈŠBŸB‚‹ËÈİXš™XİÈHÛ\ÜÈ
Œ‹LLKL‹ØÜËÛ[Ù[\ËÜİXš™XİËXKXÛ\ÜË›Y
NˆHİXš™Xİ‹ËÈY[ˆœ›ÛH™\İ[ËˆÚ[HHYH\Y\ËHİXš™XİÚİÜÈÛˆ›È™\Ü‹ËÈØ\™œ›ØYÚY]Ü[Üˆ™\İ[ÚXÚÙ\ˆ[™Ûİ[È[ˆ›Èİ[]™\˜YÙB‹ËÈÜˆÜÚ][ÛÈØÛÜ™\È\™HÙ\ˆØÛÜNˆT“H
Û\Ü×Ø\›WÚY
KU‘S‹ËÈ
Û\Ü×Û]™[ÚY
HÜˆĞÒÓÓˆ[[ˆT“H
\›WÚYÛ›JKQPTˆ
H\›IÜÂ‹ËÈXØY[ZXÈYX\ŠHÜˆS‘Q’S’UKˆ[šY[™Èİ[\È[šY[—Ø]È›İÜÈ\™HÙ\‹ËÈ›ÜˆH™XÛÜ™‚›[Ù[İXš™XİYHÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆİXš™XİYİš[™ÈX\
œİXš™XİÚYŠBˆØÛÜHİš[™ÈËÈT“HU‘SĞÒÓÓˆÛ\ÜĞ\›RYİš[™ÏÈX\
˜Û\Ü×Ø\›WÚYŠBˆÛ\ÜÓ]™[Yİš[™ÏÈX\
˜Û\Ü×Û]™[ÚYŠBˆ[[İš[™ÈËÈT“HQPTˆS‘Q’S’UBˆ\›RYİš[™ÈX\
\›WÚYŠBˆXØY[ZXÖYX\’Yİš[™ÈX\
˜XØY[ZX×ŞYX\—ÚYŠBˆY[Hİš[™ÈX\
šY[—ØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ[šY[]]U[YOÈX\
[šY[—Ø]ŠBˆ[šY[Hİš[™ÏÈX\
[šY[—ØHŠB‚ˆİXš™XİİXš™Xİ™[][ÛŠšY[ÎˆÜİXš™XİYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJBˆ\›H\›H™[][ÛŠšY[Îˆİ\›RYK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[™^
ÜØÚÛÛY[šY[]JBˆ[™^
ÜİXš™XİYJBˆX\
œİXš™XİÚY\ÈŠBŸB‚‹ËÈÜ\˜][Û˜[[›ÚXÙH›ÜÜØ[Ëˆ›ÈÛÛ™\œØ][Ûˆ˜[œØÜš\Üˆ[Ù[^‚‹ËÈZ[ˆØÚÛÛİ\Ù\ˆ™Y™\™[˜Ù\È›ÛİÈ[›ÚXÙIÜÈ[[]]X›H]Y]ÛÛ™[[Û‹‚›[Ù[\ÜÚ\İ[š[[™Ô[ˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ™\]Y\İYHİš[™ÈX\
œ™\]Y\İYØHŠBˆ\›İ™YHİš[™ÏÈX\
˜\›İ™YØHŠBˆİ]\Èİš[™ÈY˜][
”S‘S‘ÈŠBˆ^[ØYœÛÛ‚ˆ™]šY]Ò\Úİš[™ÈX\
œ™]šY]×Ú\ÚŠBˆ™\İ[œÛÛÂˆ^\™\Ğ]]U[YHX\
™^\™\×Ø]ŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\›İ™Y]]U[YOÈX\
˜\›İ™YØ]ŠB‚ˆ[™^
ÜØÚÛÛYÜ™X]Y]
ÛÜˆ\ØÊWJBˆX\
˜\ÜÚ\İ[Øš[[™×Ü[œÈŠBŸB‚‹ËÈÙ\™\‹[İÛ™YÛÜšÙ›İÈ›ÜÜØ[È
Œ‹LLKLKØÜËÛ[Ù[\ËÜİY[Z[ZÙK\›ÜÜØ[Ë›Y
K‚‹ËÈH™\\™Y™]šY]ÙY˜]ÚÙˆÜ\˜][Û˜[ÛÜšËÛÛ™š\›YYHH\œÛÛˆ[™‹ËÈ^Xİ]YÛ˜ÙKˆÚ[™]YÙÙYÛÈ]\ˆÛÜšÙ›İÜÈ™]\ÙH]ÈHš\œİÚ[™\Â‹ËÈœİY[Z[ZÙH‹ˆ^[ØYÛÈHÜ\˜][Û˜[›İÜÈÛ›HÚ[H^H\™B‹ËÈ™YYY
[[ÛÛ\][ÛˆÜˆ^\JH[™\È[ˆÛX\™YÈİ[[X\X™\İ[‹ËÈ[™Hš[™Ù\œš[È\™HY]Y]Kˆ›È[Ù[^ÜˆÚ]]™\È\™K‚›[Ù[ÛÜšÙ›İÔ›ÜÜØ[ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÚ[™İš[™Âˆ™\]Y\İYHİš[™ÈX\
œ™\]Y\İYØHŠBˆÛÛ™š\›YYHİš[™ÏÈX\
˜ÛÛ™š\›YYØHŠBˆİ]\Èİš[™ÈY˜][
”S‘S‘ÈŠBˆÛY[™\]Y\İYİš[™ÈX\
˜ÛY[Ü™\]Y\İÚYŠBˆ™\]Y\İ\Úİš[™ÈX\
œ™\]Y\İÚ\ÚŠBˆ™]šY]Ò\Úİš[™ÈX\
œ™]šY]×Ú\ÚŠBˆ^[ØYœÛÛÂˆİ[[X\HœÛÛ‚ˆ™\İ[œÛÛÂˆ^\™\Ğ]]U[YHX\
™^\™\×Ø]ŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆÛÛ™š\›YY]]U[YOÈX\
˜ÛÛ™š\›YYØ]ŠBˆ]PÛX\™Y]]U[YOÈX\
™]WØÛX\™YØ]ŠB‚ˆ[š\]YJÜØÚÛÛYÚ[™™\]Y\İYKÛY[™\]Y\İYKX\ˆÛÜšÙ›İ×Ü›ÜÜØ[×ØÛY[Ü™\]Y\İÚÙ^HŠBˆ[™^
ÜØÚÛÛYÚ[™Ü™X]Y]
ÛÜˆ\ØÊWJBˆX\
ÛÜšÙ›İ×Ü›ÜÜØ[ÈŠBŸB‚‹ËÈ\˜X›H™YH™[Z[™\ˆØ[\ZYÛœÈ
Œ‹LLKLKØÜËÛ[Ù[\ËÜ™[Z[™\‹XØ[\ZYÛœË›Y
K‚‹ËÈÜ™X]YHÛÛ™š\›Z[™ÈH™]šY]ÙYÛÜšÙ›İÈ›ÜÜØ[È]ÈÙ[™È\™H[ˆİ]›Ş‹ËÈÛ[™ÈYÈ[™İ]\ÈÛ›K™]™\ˆÛÛXİ]Z[Ë^Üˆ[[İ[Ë‚›[Ù[™[Z[™\Ø[\ZYÛˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ›ÜÜØ[Yİš[™È[š\]YHX\
œ›ÜÜØ[ÚYŠBˆ\›RYİš[™ÈX\
\›WÚYŠBˆ™\]Y\İYHİš[™ÈX\
œ™\]Y\İYØHŠBˆÛÛ™š\›YYHİš[™ÈX\
˜ÛÛ™š\›YYØHŠBˆİ]\Èİš[™ÈY˜][
”•S“’S‘ÈŠBˆ[™X\ÛÛˆİš[™ÏÈX\
š[Ü™X\ÛÛˆŠBˆ[\]U™\œÚ[Ûˆİš[™ÈX\
[\]Wİ™\œÚ[ÛˆŠBˆ[˜ÛYT^[Y[[œÈ›ÛÛX[ˆX\
š[˜ÛYWÜ^[Y[Ü[œÈŠBˆİ™\™YSÛ›H›ÛÛX[ˆX\
›İ™\™YWÛÛ›HŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YHY˜][
›İÊ
JHX\
\]YØ]ŠBˆ[Y]]U[YOÈX\
š[YØ]ŠBˆÛÛ\]Y]]U[YOÈX\
˜ÛÛ\]YØ]ŠBˆÙ[™È™[Z[™\Ø[\ZYÛ”Ù[™×B‚ˆ[™^
ÜØÚÛÛYİ]\×JBˆX\
œ™[Z[™\—ØØ[\ZYÛœÈŠBŸB‚›[Ù[™[Z[™\Ø[\ZYÛ”Ù[™ÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆØ[\ZYÛ’Yİš[™ÈX\
˜Ø[\ZYÛ—ÚYŠBˆİY[Yİš[™ÈX\
œİY[ÚYŠBˆİX\™X[’Yİš[™ÈX\
™İX\™X[—ÚYŠBˆÚ[›™[İš[™ÂˆÚ[›™[\ÙYİš[™ÏÈX\
˜Ú[›™[İ\ÙYŠBˆİ]\Èİš[™ÈY˜][
”S‘S‘ÈŠBˆ™X\ÛÛˆİš[™ÏÂˆÛZ[UÚÙ[ˆİš[™ÏÈX\
˜ÛZ[WİÚÙ[ˆŠBˆÛZ[YY]]U[YOÈX\
˜ÛZ[YYØ]ŠBˆš[š\ÚY]]U[YOÈX\
™š[š\ÚYØ]ŠBˆ›İšY\”™Yˆİš[™ÏÈX\
œ›İšY\—Ü™YˆŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆØ[\ZYÛˆ™[Z[™\Ø[\ZYÛˆ™[][ÛŠšY[ÎˆØØ[\ZYÛ’YK™Y™\™[˜Ù\ÎˆÚYKÛ‘[]NˆØ\ØØYJB‚ˆ[š\]YJØØ[\ZYÛ’YİY[YÚ[›™[İX\™X[’YKX\ˆœ™[Z[™\—ØØ[\ZYÛ—ÜÙ[™×ÜÛİÚÙ^HŠBˆ[™^
ÜØÚÛÛYØ[\ZYÛ’Yİ]\×JBˆX\
œ™[Z[™\—ØØ[\ZYÛ—ÜÙ[™ÈŠBŸB‚‹ËÈKKKKKKKKKHİÜ™HÜ™\œÈ
Œ‹LLKLLKØÜËÛ[Ù[\ËÜİÜ™K[Ü™\œË›Y
HKKKKKKKKKB‹ËÂ‹ËÈÛ™H^Y\‹X[H[™\ËÛ™Hİ[ˆİY[È\™Hš[YÛˆH™Y\È[›ÚXÙB‹ËÈ
Ú\™Ù\ÊHÜˆÛˆHİÜ™H[›ÚXÙHÙˆZ\ˆİÛÈİY™ˆ[™Ø[ËZ[ˆ^Y\œÈ^H]‹ËÈHÛİ[\‹ˆİØÚÈX]™\È][™[İ™\‹\ÈHÑS[İ™[Y[YYÈH[™K‚‚™[[HİÜ™SÜ™\^Y\ˆÂˆÕQS•ˆÕQ‘‚ˆĞS×ÒS‚ŸB‚™[[HİÜ™SÜ™\š[[™ÈÂˆ‘QT×ÒS•“ÒPÑBˆÕÔ‘WÒS•“ÒPÑBˆÓÕS•T‚ŸB‚™[[HİÜ™SÜ™\”İ]\ÈÂˆPÕU‘BˆĞSÑSQŸB‚›[Ù[İÜ™TXÚÈÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ˜[YHİš[™Âˆ›İHİš[™ÏÂˆ\ĞXİ]™H›ÛÛX[ˆY˜][
YJHX\
š\×ØXİ]™HŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆ\]Y]]U[YH\]Y]X\
\]YØ]ŠB‚ˆ][\ÈİÜ™TXÚÒ][V×BˆÜ™\œÈİÜ™SÜ™\–×B‚ˆ[š\]YJÜØÚÛÛYYJBˆX\
œİÜ™WÜXÚÜÈŠBŸB‚›[Ù[İÜ™TXÚÒ][HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆXÚÒYİš[™ÈX\
œXÚ×ÚYŠBˆ][RYİš[™ÈX\
š][WÚYŠBˆ]X[]H[‚ˆXÚÈİÜ™TXÚÈ™[][ÛŠšY[ÎˆÜØÚÛÛYXÚÒYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJBˆ][HİÜ™R][H™[][ÛŠšY[ÎˆÜØÚÛÛY][RYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYKÛ‘[]NˆØ\ØØYJB‚ˆX\
œİÜ™WÜXÚ×Ú][\ÈŠBŸB‚›[Ù[İÜ™SÜ™\ˆÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆ[X™\ˆ[ˆ^Y\ˆİÜ™SÜ™\^Y\‚ˆİY[Yİš[™ÏÈX\
œİY[ÚYŠBˆ\Ù\’Yİš[™ÏÈX\
\Ù\—ÚYŠBˆ^Y\“˜[YHİš[™ÏÈX\
˜^Y\—Û˜[YHŠBˆš[[™ÈİÜ™SÜ™\š[[™Âˆİ]\ÈİÜ™SÜ™\”İ]\ÈY˜][
PÕU‘JBˆİ[[ËÈÛØ›Âˆ\›RYİš[™ÏÈX\
\›WÚYŠBˆ[›ÚXÙRYİš[™ÏÈX\
š[›ÚXÙWÚYŠBˆÛİ[\“Y]Ù^[Y[Y]ÙÈX\
˜Ûİ[\—ÛY]ÙŠBˆÛİ[\”™Y™\™[˜ÙHİš[™ÏÈX\
˜Ûİ[\—Ü™Y™\™[˜ÙHŠBˆXÚÒYİš[™ÏÈX\
œXÚ×ÚYŠBˆÛ\ÜÔØ[RYİš[™ÏÈX\
˜Û\Ü×ÜØ[WÚYŠBˆ›İHİš[™ÏÂˆY[\İ[˜ŞRÙ^Hİš[™ÏÈX\
šY[\İ[˜ŞWÚÙ^HŠBˆÜ™X]YHİš[™ÈX\
˜Ü™X]YØHŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠBˆØ[˜Ù[YHİš[™ÏÈX\
˜Ø[˜Ù[YØHŠBˆØ[˜Ù[Y]]U[YOÈX\
˜Ø[˜Ù[YØ]ŠBˆØ[˜Ù[™X\ÛÛˆİš[™ÏÈX\
˜Ø[˜Ù[Ü™X\ÛÛˆŠB‚ˆXÚÈİÜ™TXÚÏÈ™[][ÛŠšY[ÎˆÜØÚÛÛYXÚÒYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆ[™\ÈİÜ™SÜ™\“[™V×B‚ˆ[š\]YJÜØÚÛÛYYJBˆ[š\]YJÜØÚÛÛY[X™\—JBˆ[™^
ÜØÚÛÛYÜ™X]Y]JBˆ[™^
ÜİY[YJBˆ[™^
ØÛ\ÜÔØ[RYJBˆX\
œİÜ™WÛÜ™\œÈŠBŸB‚›[Ù[İÜ™SÜ™\“[™HÂˆYİš[™ÈYY˜][
]ZY

JBˆØÚÛÛYİš[™ÈX\
œØÚÛÛÚYŠBˆÜ™\’Yİš[™ÈX\
›Ü™\—ÚYŠBˆ][RYİš[™ÈX\
š][WÚYŠBˆ˜\šX[Yİš[™ÈX\
˜\šX[ÚYŠBˆ]X[]H[ˆ[š]šXÙH[X\
[š]ÜšXÙHŠHËÈÛØ›Âˆ[[İ[[ËÈÛØ›ÂˆÛÛXİY[Y˜][

BˆÚ\™ÙRYİš[™ÏÈX\
˜Ú\™ÙWÚYŠBˆÜ™X]Y]]U[YHY˜][
›İÊ
JHX\
˜Ü™X]YØ]ŠB‚ˆÜ™\ˆİÜ™SÜ™\ˆ™[][ÛŠšY[ÎˆÜØÚÛÛYÜ™\’YK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆ][HİÜ™R][H™[][ÛŠšY[ÎˆÜØÚÛÛY][RYK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆ˜\šX[İÜ™R][U˜\šX[™[][ÛŠšY[ÎˆÜØÚÛÛY˜\šX[YK™Y™\™[˜Ù\ÎˆÜØÚÛÛYYJBˆ[İ™[Y[ÈİÜ™S[İ™[Y[×B‚ˆ[š\]YJÜØÚÛÛYYJBˆ[™^
ÛÜ™\’YJBˆ[™^
İ˜\šX[YJBˆX\
œİÜ™WÛÜ™\—Û[™\ÈŠBŸB