import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AcademicYearDto,
  type CreateAcademicYearInput,
  type UpdateAcademicYearInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// AUDIT ACTION NAMING — singular resource, dotted verb (e.g. "school.update",
// "user.invite"). The Phase 1 spec sometimes uses the casual hyphenated-plural
// form ("academic-years.create") in prose; we normalise to the Phase 0
// convention in code. See docs/modules/phase-1.md "Audit interceptor" note.
const AUDIT = {
  create: "academic-year.create",
  update: "academic-year.update",
  delete: "academic-year.delete",
  setCurrent: "academic-year.set-current",
} as const;

@Injectable()
export class AcademicYearsService {
  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  async list(authCtx: AuthContext): Promise<AcademicYearDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.academicYear.findMany({
        select: ACADEMIC_YEAR_SELECT,
        orderBy: { startDate: "desc" },
      });
      return rows.map(toAcademicYearDto);
    });
  }

  // -----------------------------------------------------------------------
  // get one
  // -----------------------------------------------------------------------
  async findById(authCtx: AuthContext, id: string): Promise<AcademicYearDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.academicYear.findUnique({
        where: { id },
        select: ACADEMIC_YEAR_SELECT,
      });
      if (!row) throw new NotFoundError("Academic year not found.");
      return toAcademicYearDto(row);
    });
  }

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  async create(
    authCtx: AuthContext,
    input: CreateAcademicYearInput,
    reqCtx: RequestContext,
  ): Promise<AcademicYearDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      try {
        const created = await db.academicYear.create({
          data: {
            schoolId: authCtx.schoolId,
            label: input.label,
            startDate: input.startDate,
            endDate: input.endDate,
          },
          select: ACADEMIC_YEAR_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.create,
            entityType: "academic_year",
            entityId: created.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              label: created.label,
              startDate: created.startDate.toISOString(),
              endDate: created.endDate.toISOString(),
            },
          },
        });

        return toAcademicYearDto(created);
      } catch (e) {
        throw mapUniqueViolation(e, "LABEL_TAKEN", "An academic year with that label already exists.");
      }
    });
  }

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  async update(
    authCtx: AuthContext,
    id: string,
    input: UpdateAcademicYearInput,
    reqCtx: RequestContext,
  ): Promise<AcademicYearDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.academicYear.findUnique({
        where: { id },
        select: { id: true, startDate: true, endDate: true },
      });
      if (!existing) throw new NotFoundError("Academic year not found.");

      // Cross-field check against current row when only one date moves.
      const nextStart = input.startDate ?? existing.startDate;
      const nextEnd = input.endDate ?? existing.endDate;
      if (nextEnd <= nextStart) {
        throw new ValidationError("endDate must be after startDate", {
          issues: [{ path: "endDate", code: "out_of_range", message: "endDate must be after startDate" }],
        });
      }

      const data: Prisma.AcademicYearUpdateInput = {};
      if (input.label !== undefined) data.label = input.label;
      if (input.startDate !== undefined) data.startDate = input.startDate;
      if (input.endDate !== undefined) data.endDate = input.endDate;

      try {
        const updated = await db.academicYear.update({
          where: { id },
          data,
          select: ACADEMIC_YEAR_SELECT,
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.update,
            entityType: "academic_year",
            entityId: id,
            ipAddress: reqCtx.ipAddress,
            metadata: { changed: Object.keys(data) },
          },
        });

        return toAcademicYearDto(updated);
      } catch (e) {
        throw mapUniqueViolation(e, "LABEL_TAKEN", "An academic year with that label already exists.");
      }
    });
  }

  // -----------------------------------------------------------------------
  // delete
  // -----------------------------------------------------------------------
  // Slice 1 has no dependents — terms cascade via the FK. The forward-
  // compatible guard (count related rows) is unnecessary here because the
  // only direct child is `terms` and we explicitly want terms to cascade.
  // When Phase 1 slice 9 adds Enrollments referencing academic_years, this
  // guard becomes a real check; for now it's a no-op so we keep the shape.
  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.academicYear.findUnique({
        where: { id },
        select: { id: true, label: true },
      });
      if (!existing) throw new NotFoundError("Academic year not found.");

      await db.academicYear.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "academic_year",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { label: existing.label },
        },
      });
    });
  }

  // -----------------------------------------------------------------------
  // set current
  // -----------------------------------------------------------------------
  // Single-transaction flip-siblings-then-set pattern. The partial unique
  // index (school_id WHERE is_current=true) backs this — if we ever omit
  // the unflip step, the second UPDATE would fail at the DB layer. Idempotent
  // when called on a row that's already current.
  async setCurrent(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<AcademicYearDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const target = await db.academicYear.findUnique({
        where: { id },
        select: { id: true, isCurrent: true },
      });
      if (!target) throw new NotFoundError("Academic year not found.");

      if (!target.isCurrent) {
        await db.academicYear.updateMany({
          where: { isCurrent: true, id: { not: id } },
          data: { isCurrent: false },
        });
        await db.academicYear.update({
          where: { id },
          data: { isCurrent: true },
        });
      }

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.setCurrent,
          entityType: "academic_year",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });

      const reloaded = await db.academicYear.findUniqueOrThrow({
        where: { id },
        select: ACADEMIC_YEAR_SELECT,
      });
      return toAcademicYearDto(reloaded);
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

export const ACADEMIC_YEAR_SELECT = {
  id: true,
  label: true,
  startDate: true,
  endDate: true,
  isCurrent: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AcademicYearSelect;

type AcademicYearRow = Prisma.AcademicYearGetPayload<{
  select: typeof ACADEMIC_YEAR_SELECT;
}>;

export function toAcademicYearDto(row: AcademicYearRow): AcademicYearDto {
  return {
    id: row.id,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    isCurrent: row.isCurrent,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Translates Prisma unique-violation P2002 into a domain ConflictError.
// We can't read the violated constraint name under FORCE RLS (see
// CLAUDE.md "RLS hides constraint name on uniqueness errors"), but slice 1
// only has one unique-per-school constraint on this table (the label), so
// any P2002 raised here is the label collision. Subsequent slices that add
// more unique constraints will need a different discriminator path —
// likely a SECURITY DEFINER pre-check function, but we explicitly defer that
// until we actually need it.
function mapUniqueViolation(e: unknown, code: string, message: string): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ConflictError(code, message);
  }
  return e;
}
