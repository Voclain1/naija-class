import { Injectable } from "@nestjs/common";

import { Prisma, PrismaClient, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type ClassArmDto,
  type CreateClassArmInput,
  type UpdateClassArmInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIT = {
  create: "class-arm.create",
  update: "class-arm.update",
  delete: "class-arm.delete",
} as const;

@Injectable()
export class ClassArmsService {
  // ----------------------------------------------------------------------
  // list within a class level (nested-list to mirror nested-create)
  // ----------------------------------------------------------------------
  async listForLevel(
    authCtx: AuthContext,
    classLevelId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<ClassArmDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      // Validate parent exists in tenant — RLS would otherwise return [] for
      // a foreign id, which is correct but indistinguishable from "level
      // exists but has no arms yet". Mirrors terms.service.listForYear.
      const parent = await db.classLevel.findUnique({
        where: { id: classLevelId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundError("Class level not found.");

      const rows = await db.classArm.findMany({
        where: {
          classLevelId,
          ...(options.includeInactive ? {} : { isActive: true }),
        },
        select: CLASS_ARM_SELECT,
        orderBy: { name: "asc" },
      });
      return rows.map(toClassArmDto);
    });
  }

  // ----------------------------------------------------------------------
  // flat cross-level list (mirrors the spec's GET /class-arms shape)
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    options: { includeInactive?: boolean } = {},
  ): Promise<ClassArmDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.classArm.findMany({
        where: options.includeInactive ? undefined : { isActive: true },
        select: CLASS_ARM_SELECT,
        orderBy: [{ classLevelId: "asc" }, { name: "asc" }],
      });
      return rows.map(toClassArmDto);
    });
  }

  // ----------------------------------------------------------------------
  // findById (flat)
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<ClassArmDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.classArm.findUnique({
        where: { id },
        select: CLASS_ARM_SELECT,
      });
      if (!row) throw new NotFoundError("Class arm not found.");
      return toClassArmDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create (nested — POST /class-levels/:levelId/class-arms)
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    classLevelId: string,
    input: CreateClassArmInput,
    reqCtx: RequestContext,
  ): Promise<ClassArmDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const level = await db.classLevel.findUnique({
        where: { id: classLevelId },
        select: { id: true },
      });
      if (!level) throw new NotFoundError("Class level not found.");

      if (input.classTeacherId != null) {
        await assertUserIsTeacher(db, input.classTeacherId);
      }

      try {
        const created = await db.classArm.create({
          data: {
            schoolId: authCtx.schoolId,
            classLevelId,
            name: input.name,
            code: input.code,
            capacity: input.capacity ?? null,
            classTeacherId: input.classTeacherId ?? null,
            isActive: input.isActive ?? true,
          },
          select: CLASS_ARM_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "class_arm",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              classLevelId,
              code: created.code,
              name: created.name,
              capacity: created.capacity,
              classTeacherId: created.classTeacherId,
            },
          },
        });

        return toClassArmDto(created);
      } catch (e) {
        throw mapCodeUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update (flat — PATCH /class-arms/:id)
  // ----------------------------------------------------------------------
  // Reassigning classLevelId is intentionally NOT supported here — see the
  // header comment on updateClassArmSchema. The update DTO does not even
  // expose the field, so a caller can only mutate within-level attributes.
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateClassArmInput,
    reqCtx: RequestContext,
  ): Promise<ClassArmDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classArm.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Class arm not found.");

      // null means "unset"; a uuid means "validate then set". Undefined
      // means "leave alone". The Zod schema allows nullable+optional, so
      // all three states reach here distinguishably.
      if (input.classTeacherId !== undefined && input.classTeacherId !== null) {
        await assertUserIsTeacher(db, input.classTeacherId);
      }

      const data: Prisma.ClassArmUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.code !== undefined) data.code = input.code;
      if (input.capacity !== undefined) data.capacity = input.capacity;
      if (input.classTeacherId !== undefined) {
        data.classTeacher =
          input.classTeacherId === null
            ? { disconnect: true }
            : { connect: { id: input.classTeacherId } };
      }
      if (input.isActive !== undefined) data.isActive = input.isActive;

      try {
        const updated = await db.classArm.update({
          where: { id },
          data,
          select: CLASS_ARM_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "class_arm",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data) },
          },
        });

        return toClassArmDto(updated);
      } catch (e) {
        throw mapCodeUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // delete — hard-delete in slice 3. Future slices that add enrollments
  // (slice 9) will gate this with a "no enrollments" guard; soft-delete
  // via PATCH isActive=false is the recommended path in the UI.
  // ----------------------------------------------------------------------
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classArm.findUnique({
        where: { id },
        select: { id: true, name: true, code: true, classLevelId: true },
      });
      if (!existing) throw new NotFoundError("Class arm not found.");

      await db.classArm.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "class_arm",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classLevelId: existing.classLevelId,
            code: existing.code,
            name: existing.name,
          },
        },
      });
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const CLASS_ARM_SELECT = {
  id: true,
  classLevelId: true,
  name: true,
  code: true,
  capacity: true,
  classTeacherId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClassArmSelect;

type ClassArmRow = Prisma.ClassArmGetPayload<{ select: typeof CLASS_ARM_SELECT }>;

export function toClassArmDto(row: ClassArmRow): ClassArmDto {
  return {
    id: row.id,
    classLevelId: row.classLevelId,
    name: row.name,
    code: row.code,
    capacity: row.capacity,
    classTeacherId: row.classTeacherId,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Class arms have ONE unique-per-(school, level) constraint: code. Any
// P2002 here is a code collision within the level. RLS hides the
// constraint name (see CLAUDE.md "RLS hides constraint name on uniqueness
// errors") but slice 3 only has this one unique constraint on the table,
// so the discriminator is unambiguous.
function mapCodeUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "CODE_TAKEN",
      "A class arm with that code already exists under this class level.",
    );
  }
  return e;
}

// Form-teacher validation — the user must (a) exist in this tenant and
// (b) have the `teacher` role. (a) is enforced by RLS on `users` (a
// foreign user returns null from findUnique). (b) is a role-grant lookup;
// we match `role.key === "teacher"` regardless of role scope (system or
// school-scoped) because the system `teacher` role is owed by slice 13
// and pilot schools may seed their own school-scoped teacher role earlier.
//
// Why this lives in the service, not in RLS: the role-grant table is
// already RLS'd, but RLS doesn't express "user_id must have a role whose
// key is X" — that's application-level authorisation. Same posture as
// the teacher-scope filter described at docs/modules/phase-1.md:1108
// ("the teacher-scope check is an additional in-school filter — it's
// authorization, not tenancy").
async function assertUserIsTeacher(db: PrismaClient, userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, isActive: true },
  });
  if (!user) {
    throw new ValidationError("classTeacherId references a user that does not exist in this school.", {
      issues: [{ path: "classTeacherId", code: "not_found", message: "user not found" }],
    });
  }
  if (!user.isActive) {
    throw new ValidationError("classTeacherId references an inactive user.", {
      issues: [{ path: "classTeacherId", code: "inactive", message: "user is inactive" }],
    });
  }
  const grant = await db.userRole.findFirst({
    where: { userId, role: { key: "teacher" } },
    select: { userId: true },
  });
  if (!grant) {
    throw new ValidationError("classTeacherId user does not have the teacher role.", {
      issues: [{ path: "classTeacherId", code: "not_a_teacher", message: "user is not a teacher" }],
    });
  }
}
