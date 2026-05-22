import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateTermInput,
  type TermDto,
  type UpdateTermInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit action naming follows the Phase 0 convention: <singular>.<verb>.
// See AcademicYearsService for the same pattern + the spec note.
const AUDIT = {
  create: "term.create",
  update: "term.update",
  delete: "term.delete",
  setCurrent: "term.set-current",
} as const;

@Injectable()
export class TermsService {
  // -----------------------------------------------------------------------
  // list within a year
  // -----------------------------------------------------------------------
  async listForYear(
    authCtx: AuthContext,
    academicYearId: string,
  ): Promise<TermDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      // Validate parent exists in this tenant — RLS would otherwise return
      // an empty list for a foreign yearId, which is correct but mute.
      const parent = await db.academicYear.findUnique({
        where: { id: academicYearId },
        select: { id: true },
      });
      if (!parent) throw new NotFoundError("Academic year not found.");

      const rows = await db.term.findMany({
        where: { academicYearId },
        select: TERM_SELECT,
        orderBy: { sequence: "asc" },
      });
      return rows.map(toTermDto);
    });
  }

  // -----------------------------------------------------------------------
  // get one
  // -----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<TermDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.term.findUnique({
        where: { id },
        select: TERM_SELECT,
      });
      if (!row) throw new NotFoundError("Term not found.");
      return toTermDto(row);
    });
  }

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    academicYearId: string,
    input: CreateTermInput,
    reqCtx: RequestContext,
  ): Promise<TermDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const year = await db.academicYear.findUnique({
        where: { id: academicYearId },
        select: { id: true, startDate: true, endDate: true },
      });
      if (!year) throw new NotFoundError("Academic year not found.");

      // Dates must lie within parent year's range. Strict bounds (<= / >=)
      // because a term that starts before its year does or ends after the
      // year does is data corruption waiting to happen.
      if (input.startDate < year.startDate || input.endDate > year.endDate) {
        throw new ValidationError(
          "Term dates must fall within the academic year.",
          {
            issues: [
              {
                path: "startDate",
                code: "out_of_range",
                message: `Year runs ${year.startDate.toISOString().slice(0, 10)} to ${year.endDate.toISOString().slice(0, 10)}`,
              },
            ],
          },
        );
      }

      try {
        const created = await db.term.create({
          data: {
            schoolId: authCtx.schoolId,
            academicYearId,
            sequence: input.sequence,
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate,
          },
          select: TERM_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "term",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              academicYearId,
              sequence: created.sequence,
              name: created.name,
            },
          },
        });

        return toTermDto(created);
      } catch (e) {
        throw mapTermUniqueViolation(e);
      }
    });
  }

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateTermInput,
    reqCtx: RequestContext,
  ): Promise<TermDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.term.findUnique({
        where: { id },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          academicYear: { select: { startDate: true, endDate: true } },
        },
      });
      if (!existing) throw new NotFoundError("Term not found.");

      const nextStart = input.startDate ?? existing.startDate;
      const nextEnd = input.endDate ?? existing.endDate;
      if (nextEnd <= nextStart) {
        throw new ValidationError("endDate must be after startDate", {
          issues: [{ path: "endDate", code: "out_of_range", message: "endDate must be after startDate" }],
        });
      }
      if (nextStart < existing.academicYear.startDate || nextEnd > existing.academicYear.endDate) {
        throw new ValidationError("Term dates must fall within the academic year.", {
          issues: [{ path: "startDate", code: "out_of_range", message: "outside parent year" }],
        });
      }

      const data: Prisma.TermUpdateInput = {};
      if (input.sequence !== undefined) data.sequence = input.sequence;
      if (input.name !== undefined) data.name = input.name;
      if (input.startDate !== undefined) data.startDate = input.startDate;
      if (input.endDate !== undefined) data.endDate = input.endDate;

      try {
        const updated = await db.term.update({
          where: { id },
          data,
          select: TERM_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "term",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data) },
          },
        });

        return toTermDto(updated);
      } catch (e) {
        throw mapTermUniqueViolation(e);
      }
    });
  }

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.term.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundError("Term not found.");

      await db.term.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "term",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: existing.name },
        },
      });
    });
  }

  // -----------------------------------------------------------------------
  // set current — CASCADES TO PARENT YEAR
  // -----------------------------------------------------------------------
  // When admin sets Term 2 current:
  //   1. Unflip every other term in this school (one row at most thanks to
  //      the partial unique index, but updateMany is safe and explicit).
  //   2. Flip this term to current.
  //   3. Unflip every other academic year in this school.
  //   4. Flip this term's parent year to current.
  // Steps 3-4 are the cascade: admins shouldn't have to "set current year"
  // separately. This is the one invariant the DB cannot enforce — the
  // terms.service spec re-fetches the parent year after this call and
  // asserts isCurrent=true.
  async setCurrent(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<TermDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const target = await db.term.findUnique({
        where: { id },
        select: { id: true, academicYearId: true, isCurrent: true },
      });
      if (!target) throw new NotFoundError("Term not found.");

      // Flip term siblings, then this term.
      await db.term.updateMany({
        where: { isCurrent: true, id: { not: id } },
        data: { isCurrent: false },
      });
      if (!target.isCurrent) {
        await db.term.update({ where: { id }, data: { isCurrent: true } });
      }

      // Cascade: flip year siblings, then this term's parent.
      await db.academicYear.updateMany({
        where: { isCurrent: true, id: { not: target.academicYearId } },
        data: { isCurrent: false },
      });
      await db.academicYear.update({
        where: { id: target.academicYearId },
        data: { isCurrent: true },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.setCurrent,
          entityType: "term",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { academicYearId: target.academicYearId },
        },
      });

      const reloaded = await db.term.findUniqueOrThrow({
        where: { id },
        select: TERM_SELECT,
      });
      return toTermDto(reloaded);
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const TERM_SELECT = {
  id: true,
  academicYearId: true,
  sequence: true,
  name: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TermSelect;

type TermRow = Prisma.TermGetPayload<{ select: typeof TERM_SELECT }>;

export function toTermDto(row: TermRow): TermDto {
  return {
    id: row.id,
    academicYearId: row.academicYearId,
    sequence: row.sequence,
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Terms have ONE unique-per-school constraint at slice-1 time:
// (academic_year_id, sequence). Any P2002 here is a sequence collision.
function mapTermUniqueViolation(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(
      "SEQUENCE_TAKEN",
      "A term with that sequence already exists in this academic year.",
    );
  }
  return e;
}
