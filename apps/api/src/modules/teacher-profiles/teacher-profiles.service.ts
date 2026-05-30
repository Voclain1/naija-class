import { Injectable } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateTeacherProfileInput,
  type ListTeacherProfilesQuery,
  type TeacherProfileDto,
  type TeacherProfileListResponse,
  type UpdateMyTeacherProfileInput,
  type UpdateTeacherProfileInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
// Self-service edits reuse `teacher-profile.update`; the metadata `self: true`
// flag distinguishes a teacher editing their own bio from an admin edit.
const AUDIT = {
  create: "teacher-profile.create",
  update: "teacher-profile.update",
  delete: "teacher-profile.delete",
} as const;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// /me self-service is the teacher's surface; owner/admin can also hold a
// profile in principle, so they're permitted too. The profile lookup is by
// the caller's own userId, so there's no cross-user exposure regardless.
const SELF_ROLES = ["owner", "admin", "teacher"] as const;
const ADMIN_ROLES = ["owner", "admin"] as const;

@Injectable()
export class TeacherProfilesService {
  // ----------------------------------------------------------------------
  // list — cursor-paginated by id ASC. search matches staffNumber OR the
  // user's first/last name; specialty is an ILIKE contains. Pilot-scale
  // sequential scan (pg_trgm deferred, same posture as student search).
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    query: ListTeacherProfilesQuery,
  ): Promise<TeacherProfileListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIN_ROLES);

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.TeacherProfileWhereInput = {};
      if (query.cursor) where.id = { gt: query.cursor };
      if (query.specialty) {
        where.specialty = { contains: query.specialty, mode: "insensitive" };
      }
      if (query.search) {
        where.OR = [
          { staffNumber: { contains: query.search, mode: "insensitive" } },
          { user: { firstName: { contains: query.search, mode: "insensitive" } } },
          { user: { lastName: { contains: query.search, mode: "insensitive" } } },
        ];
      }

      const rows = await db.teacherProfile.findMany({
        where,
        select: TEACHER_PROFILE_SELECT,
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const cursor = hasNext ? page[page.length - 1].id : undefined;

      return {
        data: page.map(toTeacherProfileDto),
        meta: cursor === undefined ? {} : { cursor },
      };
    });
  }

  // ----------------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<TeacherProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIN_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.teacherProfile.findUnique({
        where: { id },
        select: TEACHER_PROFILE_SELECT,
      });
      if (!row) throw new NotFoundError("Teacher profile not found.");
      return toTeacherProfileDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create — admin-explicit (Q2 lifecycle). The target User must exist in
  // this tenant, be active, and hold the teacher role. We pre-check BOTH
  // unique constraints (userId 1:1, and (schoolId, staffNumber)) so we can
  // return a precise 409 — under FORCE RLS the P2002 constraint name is
  // stripped, so a bare catch can't tell which collided. The catch below is
  // a race-condition safety net only.
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateTeacherProfileInput,
    reqCtx: RequestContext,
  ): Promise<TeacherProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIN_ROLES);

    return withTenant(authCtx.schoolId, async (db) => {
      await assertUserIsTeacher(db, input.userId);

      // userId is 1:1 — one profile per user.
      const existingForUser = await db.teacherProfile.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      });
      if (existingForUser) {
        throw new ConflictError(
          "PROFILE_ALREADY_EXISTS",
          "This user already has a teacher profile. Edit the existing one instead.",
        );
      }

      await assertStaffNumberAvailable(db, input.staffNumber, null);

      try {
        const created = await db.teacherProfile.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: input.userId,
            staffNumber: input.staffNumber,
            qualifications: input.qualifications ?? null,
            specialty: input.specialty ?? null,
            nutNumber: input.nutNumber ?? null,
          },
          select: TEACHER_PROFILE_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "teacher_profile",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            // PII-free: ids + staff number only (no names/email).
            metadata: {
              profileUserId: created.userId,
              staffNumber: created.staffNumber,
            },
          },
        });

        return toTeacherProfileDto(created);
      } catch (e) {
        throw mapTeacherProfileUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update — admin-edit. staffNumber uniqueness re-checked on change.
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateTeacherProfileInput,
    reqCtx: RequestContext,
  ): Promise<TeacherProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIN_ROLES);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.teacherProfile.findUnique({
        where: { id },
        select: { id: true, staffNumber: true },
      });
      if (!existing) throw new NotFoundError("Teacher profile not found.");

      const data: Prisma.TeacherProfileUpdateInput = {};
      if (input.staffNumber !== undefined && input.staffNumber !== existing.staffNumber) {
        await assertStaffNumberAvailable(db, input.staffNumber, id);
        data.staffNumber = input.staffNumber;
      }
      if (input.qualifications !== undefined) data.qualifications = input.qualifications;
      if (input.specialty !== undefined) data.specialty = input.specialty;
      if (input.nutNumber !== undefined) data.nutNumber = input.nutNumber;

      try {
        const updated = await db.teacherProfile.update({
          where: { id },
          data,
          select: TEACHER_PROFILE_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "teacher_profile",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data), self: false },
          },
        });

        return toTeacherProfileDto(updated);
      } catch (e) {
        throw mapTeacherProfileUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // delete — soft-delete via User.isActive=false; the profile row is
  // PRESERVED (per phase-1.md:782). Deactivating the user is what actually
  // removes their access (AuthGuard + assertUserActiveAndHasOneOf reject
  // !isActive); the profile is kept as a staff record.
  // ----------------------------------------------------------------------
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ADMIN_ROLES);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.teacherProfile.findUnique({
        where: { id },
        select: { id: true, userId: true, staffNumber: true },
      });
      if (!existing) throw new NotFoundError("Teacher profile not found.");

      await db.user.update({
        where: { id: existing.userId },
        data: { isActive: false },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "teacher_profile",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            profileUserId: existing.userId,
            staffNumber: existing.staffNumber,
            softDeleted: true, // user deactivated; profile row preserved
          },
        },
      });
    });
  }

  // ----------------------------------------------------------------------
  // getMine — the caller's own profile (teacher self-service). Returns the
  // DTO or throws 404 when the admin hasn't created one yet. The teacher
  // portal renders an empty-state on 404 (Q2: no auto-create on accept).
  // ----------------------------------------------------------------------
  async getMine(authCtx: AuthContext): Promise<TeacherProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, SELF_ROLES);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.teacherProfile.findUnique({
        where: { userId: authCtx.userId },
        select: TEACHER_PROFILE_SELECT,
      });
      if (!row) {
        throw new NotFoundError(
          "You don't have a teacher profile yet. Ask your school admin to set one up.",
        );
      }
      return toTeacherProfileDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // updateMine — teacher self-edit. Only specialty + qualifications (the DTO
  // strips everything else). staffNumber / nutNumber are admin-only and not
  // reachable here.
  // ----------------------------------------------------------------------
  async updateMine(
    authCtx: AuthContext,
    input: UpdateMyTeacherProfileInput,
    reqCtx: RequestContext,
  ): Promise<TeacherProfileDto> {
    await assertUserActiveAndHasOneOf(authCtx, SELF_ROLES);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.teacherProfile.findUnique({
        where: { userId: authCtx.userId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundError(
          "You don't have a teacher profile yet. Ask your school admin to set one up.",
        );
      }

      const data: Prisma.TeacherProfileUpdateInput = {};
      if (input.specialty !== undefined) data.specialty = input.specialty;
      if (input.qualifications !== undefined) data.qualifications = input.qualifications;

      const updated = await db.teacherProfile.update({
        where: { id: existing.id },
        data,
        select: TEACHER_PROFILE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "teacher_profile",
          entityId: existing.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { changed: Object.keys(data), self: true },
        },
      });

      return toTeacherProfileDto(updated);
    });
  }
}

// -------------------------------------------------------------------------
// Internal helpers
// -------------------------------------------------------------------------

const TEACHER_PROFILE_SELECT = {
  id: true,
  userId: true,
  staffNumber: true,
  qualifications: true,
  specialty: true,
  nutNumber: true,
  joinedAt: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
    },
  },
} satisfies Prisma.TeacherProfileSelect;

type TeacherProfileRow = Prisma.TeacherProfileGetPayload<{
  select: typeof TEACHER_PROFILE_SELECT;
}>;

function toTeacherProfileDto(row: TeacherProfileRow): TeacherProfileDto {
  return {
    id: row.id,
    userId: row.userId,
    staffNumber: row.staffNumber,
    qualifications: row.qualifications,
    specialty: row.specialty,
    nutNumber: row.nutNumber,
    joinedAt: row.joinedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    user: {
      id: row.user.id,
      firstName: row.user.firstName,
      lastName: row.user.lastName,
      email: row.user.email,
      isActive: row.user.isActive,
    },
  };
}

// Form-teacher-style validation: the userId must reference a user that
// exists in this tenant (RLS returns null for a foreign id), is active, and
// holds the teacher role. Mirrors class-arms' assertUserIsTeacher — kept
// local rather than shared to avoid cross-module coupling on a 20-line gate.
async function assertUserIsTeacher(db: PrismaClient, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user) {
    throw new ValidationError("userId references a user that does not exist in this school.", {
      issues: [{ path: "userId", code: "not_found", message: "user not found" }],
    });
  }
  if (!user.isActive) {
    throw new ValidationError("userId references an inactive user.", {
      issues: [{ path: "userId", code: "inactive", message: "user is inactive" }],
    });
  }
  const grant = await db.userRole.findFirst({
    where: { userId, role: { key: "teacher" } },
    select: { userId: true },
  });
  if (!grant) {
    throw new ValidationError("userId user does not have the teacher role.", {
      issues: [{ path: "userId", code: "not_a_teacher", message: "user is not a teacher" }],
    });
  }
}

// Pre-check (schoolId, staffNumber) uniqueness. `excludeId` lets update skip
// the row being edited. RLS scopes the query to this school already.
async function assertStaffNumberAvailable(
  db: PrismaClient,
  staffNumber: string,
  excludeId: string | null,
): Promise<void> {
  const clash = await db.teacherProfile.findFirst({
    where: {
      staffNumber,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      "STAFF_NUMBER_TAKEN",
      "Another teacher in this school already has that staff number.",
    );
  }
}

// teacher_profiles has TWO unique-per-school constraints: user_id (1:1) and
// (school_id, staff_number). Both are pre-checked before insert/update, so a
// P2002 reaching here is a race we lost between the pre-check and the write.
// Under FORCE RLS the target field name is stripped, so we cannot tell which
// constraint collided — return a generic 409 and let the client re-fetch.
function mapTeacherProfileUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "TEACHER_PROFILE_CONFLICT",
      "This teacher profile conflicts with an existing one (staff number or user already in use).",
    );
  }
  return e;
}
