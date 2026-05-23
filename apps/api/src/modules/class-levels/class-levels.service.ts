import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type ClassLevelDto,
  type CreateClassLevelInput,
  type UpdateClassLevelInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb. Same convention as
// AcademicYearsService (locked in slice 1).
const AUDIT = {
  create: "class-level.create",
  update: "class-level.update",
  delete: "class-level.delete",
} as const;

@Injectable()
export class ClassLevelsService {
  // ----------------------------------------------------------------------
  // list — orderIndex ASC, then name ASC for tie-break. Defaults to active
  // only; pass includeInactive=true to see deactivated rows too.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    options: { includeInactive?: boolean } = {},
  ): Promise<ClassLevelDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.classLevel.findMany({
        where: options.includeInactive ? undefined : { isActive: true },
        select: CLASS_LEVEL_SELECT,
        orderBy: [{ orderIndex: "asc" }, { name: "asc" }],
      });
      return rows.map(toClassLevelDto);
    });
  }

  // ----------------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<ClassLevelDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.classLevel.findUnique({
        where: { id },
        select: CLASS_LEVEL_SELECT,
      });
      if (!row) throw new NotFoundError("Class level not found.");
      return toClassLevelDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateClassLevelInput,
    reqCtx: RequestContext,
  ): Promise<ClassLevelDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      try {
        const created = await db.classLevel.create({
          data: {
            schoolId: authCtx.schoolId,
            name: input.name,
            code: input.code,
            stage: input.stage,
            orderIndex: input.orderIndex,
            isActive: input.isActive ?? true,
          },
          select: CLASS_LEVEL_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "class_level",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              code: created.code,
              name: created.name,
              stage: created.stage,
              orderIndex: created.orderIndex,
            },
          },
        });

        return toClassLevelDto(created);
      } catch (e) {
        throw mapCodeUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateClassLevelInput,
    reqCtx: RequestContext,
  ): Promise<ClassLevelDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classLevel.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Class level not found.");

      const data: Prisma.ClassLevelUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.code !== undefined) data.code = input.code;
      if (input.stage !== undefined) data.stage = input.stage;
      if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      try {
        const updated = await db.classLevel.update({
          where: { id },
          data,
          select: CLASS_LEVEL_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "class_level",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data) },
          },
        });

        return toClassLevelDto(updated);
      } catch (e) {
        throw mapCodeUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // delete — hard-delete with a forward-compatible guard for slice 3.
  //
  // Slice 2 has no `class_arms` table, so the guard is structurally a no-op
  // (no dependents possible). When slice 3 lands and ClassArm appears, the
  // guard reads `db.classArm.count({ where: { classLevelId: id } })` and
  // throws ConflictError("LEVEL_HAS_ARMS", ...) if > 0. Soft-delete (toggle
  // isActive=false) is the recommended path in the UI; this hard-delete
  // exists for schools that want a level genuinely gone.
  // ----------------------------------------------------------------------
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classLevel.findUnique({
        where: { id },
        select: { id: true, name: true, code: true },
      });
      if (!existing) throw new NotFoundError("Class level not found.");

      // Slice 3 will add: const armCount = await db.classArm.count({
      //   where: { classLevelId: id },
      // });
      // if (armCount > 0) throw new ConflictError("LEVEL_HAS_ARMS", ...);

      await db.classLevel.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "class_level",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { code: existing.code, name: existing.name },
        },
      });
    });
  }
}

// ------------------------------------------------------------------------
// helpers
// ------------------------------------------------------------------------

export const CLASS_LEVEL_SELECT = {
  id: true,
  name: true,
  code: true,
  stage: true,
  orderIndex: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ClassLevelSelect;

type ClassLevelRow = Prisma.ClassLevelGetPayload<{
  select: typeof CLASS_LEVEL_SELECT;
}>;

export function toClassLevelDto(row: ClassLevelRow): ClassLevelDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    stage: row.stage,
    orderIndex: row.orderIndex,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Translates Prisma's P2002 into a typed ConflictError. The only unique
// constraint on class_levels (apart from the primary key) is (school_id,
// code), so any P2002 raised here is the code collision. If a future slice
// adds another unique, this discriminator gets the same SECURITY DEFINER
// pre-check treatment academic-years left for itself.
function mapCodeUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "CODE_TAKEN",
      "A class level with that code already exists.",
    );
  }
  return e;
}
