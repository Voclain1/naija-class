import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type BulkClassSubjectsInput,
  type ClassSubjectDto,
  type CreateClassSubjectInput,
  type UpdateClassSubjectInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIT = {
  create: "class-subject.create",
  update: "class-subject.update",
  delete: "class-subject.delete",
  bulk: "class-subject.bulk",
} as const;

@Injectable()
export class ClassSubjectsService {
  // ----------------------------------------------------------------------
  // list within a class level
  // ----------------------------------------------------------------------
  async listForLevel(
    authCtx: AuthContext,
    classLevelId: string,
  ): Promise<ClassSubjectDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const parent = await db.classLevel.findUnique({
        where: { id: classLevelId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundError("Class level not found.");

      const rows = await db.classSubject.findMany({
        where: { classLevelId },
        select: CLASS_SUBJECT_SELECT,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toClassSubjectDto);
    });
  }

  // ----------------------------------------------------------------------
  // findById
  // ----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<ClassSubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.classSubject.findUnique({
        where: { id },
        select: CLASS_SUBJECT_SELECT,
      });
      if (!row) throw new NotFoundError("Class-subject link not found.");
      return toClassSubjectDto(row);
    });
  }

  // ----------------------------------------------------------------------
  // create (single — POST /class-levels/:levelId/class-subjects)
  // ----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    classLevelId: string,
    input: CreateClassSubjectInput,
    reqCtx: RequestContext,
  ): Promise<ClassSubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const [level, subject] = await Promise.all([
        db.classLevel.findUnique({ where: { id: classLevelId }, select: { id: true } }),
        db.subject.findUnique({ where: { id: input.subjectId }, select: { id: true } }),
      ]);
      if (!level) throw new NotFoundError("Class level not found.");
      if (!subject) throw new NotFoundError("Subject not found.");

      try {
        const created = await db.classSubject.create({
          data: {
            schoolId: authCtx.schoolId,
            classLevelId,
            subjectId: input.subjectId,
            isCore: input.isCore ?? true,
          },
          select: CLASS_SUBJECT_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "class_subject",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: { classLevelId, subjectId: input.subjectId, isCore: created.isCore },
          },
        });

        return toClassSubjectDto(created);
      } catch (e) {
        throw mapClassSubjectUniqueViolation(e);
      }
    });
  }

  // ----------------------------------------------------------------------
  // update (PATCH /class-subjects/:id — only isCore is editable)
  // ----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateClassSubjectInput,
    reqCtx: RequestContext,
  ): Promise<ClassSubjectDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classSubject.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Class-subject link not found.");

      const updated = await db.classSubject.update({
        where: { id },
        data: { isCore: input.isCore },
        select: CLASS_SUBJECT_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "class_subject",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { isCore: input.isCore },
        },
      });

      return toClassSubjectDto(updated);
    });
  }

  // ----------------------------------------------------------------------
  // delete (DELETE /class-subjects/:id)
  // ----------------------------------------------------------------------
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.classSubject.findUnique({
        where: { id },
        select: { id: true, classLevelId: true, subjectId: true },
      });
      if (!existing) throw new NotFoundError("Class-subject link not found.");

      await db.classSubject.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "class_subject",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classLevelId: existing.classLevelId,
            subjectId: existing.subjectId,
          },
        },
      });
    });
  }

  // ----------------------------------------------------------------------
  // BULK (POST /class-levels/:levelId/class-subjects/bulk)
  // ----------------------------------------------------------------------
  // Atomic create + delete for a single class level. The whole operation
  // runs inside a single withTenant transaction; ANY failure (parent not
  // found, subject not found, duplicate link, delete-of-non-existent,
  // FK violation) rolls back the entire batch — no partial state.
  //
  // Failure semantics:
  //   - Parent level not in tenant            → NotFoundError, nothing persisted
  //   - Any subjectId not in tenant            → NotFoundError, nothing persisted
  //   - Duplicate (level, subject) link        → ConflictError(LINK_EXISTS),
  //                                              nothing persisted
  //   - Any delete id not in tenant/level      → NotFoundError, nothing persisted
  //   - Empty arrays both                      → caught by Zod refine, 400
  //
  // Audit: ONE row per bulk op (with counts in metadata) — not per entry.
  // The same per-bulk-op convention CSV import uses (docs/modules/
  // phase-1.md → CSV import).
  async bulk(
    authCtx: AuthContext,
    classLevelId: string,
    input: BulkClassSubjectsInput,
    reqCtx: RequestContext,
  ): Promise<ClassSubjectDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const level = await db.classLevel.findUnique({
        where: { id: classLevelId },
        select: { id: true },
      });
      if (!level) throw new NotFoundError("Class level not found.");

      // Validate every subject id referenced by the create payload is in
      // tenant before touching the DB. One query (findMany IN list) beats
      // N findUniques, and lets us throw a single NotFoundError naming the
      // missing id(s).
      if (input.create.length > 0) {
        const subjectIds = input.create.map((c) => c.subjectId);
        const found = await db.subject.findMany({
          where: { id: { in: subjectIds } },
          select: { id: true },
        });
        const foundIds = new Set(found.map((s) => s.id));
        const missing = subjectIds.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw new NotFoundError(
            `Subject not found: ${missing.join(", ")}`,
          );
        }
      }

      // Validate every delete id is a class_subject row in this tenant AND
      // belongs to this level. Same single-query approach; same all-or-none
      // failure mode.
      if (input.delete.length > 0) {
        const rows = await db.classSubject.findMany({
          where: { id: { in: input.delete }, classLevelId },
          select: { id: true },
        });
        const foundIds = new Set(rows.map((r) => r.id));
        const missing = input.delete.filter((id) => !foundIds.has(id));
        if (missing.length > 0) {
          throw new NotFoundError(
            `Class-subject link not found in this level: ${missing.join(", ")}`,
          );
        }
      }

      // Detect duplicate (level, subject) in the create payload up front so
      // we can return a clean error before P2002 leaks from createMany.
      const incomingSubjectIds = input.create.map((c) => c.subjectId);
      if (new Set(incomingSubjectIds).size !== incomingSubjectIds.length) {
        throw new ValidationError(
          "Duplicate subjectId in bulk create payload.",
          {
            issues: [
              { path: "create", code: "duplicate", message: "subjectId repeats in payload" },
            ],
          },
        );
      }

      // Execute deletes first — they free up unique-constraint slots that
      // the creates might want to occupy (e.g. "swap Maths from level X to
      // Y" semantics where the matrix UI deletes the old link and creates
      // a new one in the same save).
      if (input.delete.length > 0) {
        await db.classSubject.deleteMany({
          where: { id: { in: input.delete }, classLevelId },
        });
      }

      const createdIds: string[] = [];
      try {
        for (const entry of input.create) {
          const created = await db.classSubject.create({
            data: {
              schoolId: authCtx.schoolId,
              classLevelId,
              subjectId: entry.subjectId,
              isCore: entry.isCore ?? true,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
        }
      } catch (e) {
        throw mapClassSubjectUniqueViolation(e);
      }

      // Reload the final state for the level so the caller sees a coherent
      // snapshot (helpful for the matrix UI's "refresh after save" path).
      const finalRows = await db.classSubject.findMany({
        where: { classLevelId },
        select: CLASS_SUBJECT_SELECT,
        orderBy: { createdAt: "asc" },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.bulk,
          entityType: "class_subject",
          entityId: classLevelId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            classLevelId,
            createdCount: input.create.length,
            deletedCount: input.delete.length,
            createdIds,
          },
        },
      });

      return finalRows.map(toClassSubjectDto);
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const CLASS_SUBJECT_SELECT = {
  id: true,
  classLevelId: true,
  subjectId: true,
  isCore: true,
  createdAt: true,
} satisfies Prisma.ClassSubjectSelect;

type ClassSubjectRow = Prisma.ClassSubjectGetPayload<{ select: typeof CLASS_SUBJECT_SELECT }>;

export function toClassSubjectDto(row: ClassSubjectRow): ClassSubjectDto {
  return {
    id: row.id,
    classLevelId: row.classLevelId,
    subjectId: row.subjectId,
    isCore: row.isCore,
    createdAt: row.createdAt,
  };
}

// class_subjects has ONE unique-per-school constraint:
// (school_id, class_level_id, subject_id). Any P2002 here is a duplicate
// link — the same subject already mapped to this level.
function mapClassSubjectUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "LINK_EXISTS",
      "This subject is already linked to this class level.",
    );
  }
  return e;
}
