import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreateSubjectInput,
  type SubjectDto,
  type UpdateSubjectInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  create: "subject.create",
  update: "subject.update",
  delete: "subject.delete",
} as const;

@Injectable()
export class SubjectsService {
  // ----------------------------------------------------------------------
  // list — name ASC; defaults to active only.
  // ----------------------------------------------------------------------
  async list(
    authCtx: AuthContext,
    options: { includeInactive?: boolean } = {},
  ): Promise<SubjectDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.subject.findMany({
        where: options.includeInactive ? undefined : { isActive: true },
        select: SUBJECT_SELECT,
        orderBy: { name: "asc" },
      });
      return rows.map(toSubjectDto);
    });
  }

  // ----------------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<SubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.subject.findUnique({
        where: { id },
        select: SUBJECT_SELECT,
      });
      if (!row) throw new NotFoundError("Subject not found.");
      return toSubjectDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateSubjectInput,
    reqCtx: RequestContext,
  ): Promise<SubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      try {
        const created = await db.subject.create({
          data: {
            schoolId: authCtx.schoolId,
            name: input.name,
            code: input.code,
            category: input.category ?? "CORE",
            isActive: input.isActive ?? true,
          },
          select: SUBJECT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "subject",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              code: created.code,
              name: created.name,
              category: created.category,
            },
          },
        });

        return toSubjectDto(created);
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
    input: UpdateSubjectInput,
    reqCtx: RequestContext,
  ): Promise<SubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.subject.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Subject not found.");

      const data: Prisma.SubjectUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.code !== undefined) data.code = input.code;
      if (input.category !== undefined) data.category = input.category;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      try {
        const updated = await db.subject.update({
          where: { id },
          data,
          select: SUBJECT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "subject",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data) },
          },
        });

        return toSubjectDto(updated);
      } catch (e) {
        throw mapCodeUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // delete — soft-delete via isActive=false is recommended; hard-delete
  // here cascades to class_subjects (FK CASCADE) which removes curriculum
  // links wholesale. Slice 4+ will add a guard for student-level usage
  // once enrollments reference subjects via grading rows.
  // ----------------------------------------------------------------------
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.subject.findUnique({
        where: { id },
        select: { id: true, name: true, code: true },
      });
      if (!existing) throw new NotFoundError("Subject not found.");

      await db.subject.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "subject",
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

export const SUBJECT_SELECT = {
  id: true,
  name: true,
  code: true,
  category: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubjectSelect;

type SubjectRow = Prisma.SubjectGetPayload<{ select: typeof SUBJECT_SELECT }>;

export function toSubjectDto(row: SubjectRow): SubjectDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    category: row.category,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Subjects has one unique-per-school constraint: (school_id, code).
// Any P2002 here is a code collision.
function mapCodeUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "CODE_TAKEN",
      "A subject with that code already exists.",
    );
  }
  return e;
}
