import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  findBoundaryTilingError,
  findWeightSumError,
  type CreateGradingComponentInput,
  type GradeBoundaryDto,
  type GradingComponentDto,
  type GradingSchemeDto,
  type ReplaceGradeBoundariesInput,
  type ReplaceGradingComponentsInput,
  type UpdateGradeBoundaryInput,
  type UpdateGradingComponentInput,
  type UpdateGradingSchemeInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// AUDIT ACTION NAMING — singular resource, dotted verb (Phase 0 convention).
// Bulk replaces write ONE row with a count in metadata, not one-per-row.
const AUDIT = {
  schemeUpdate: "grading-scheme.update",
  componentCreate: "grading-component.create",
  componentUpdate: "grading-component.update",
  componentDelete: "grading-component.delete",
  boundaryUpdate: "grade-boundary.update",
} as const;

// A tenant-scoped Prisma handle (the `db` passed into withTenant's callback).
type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

@Injectable()
export class GradingService {
  // =========================================================================
  // Scheme
  // =========================================================================

  async getScheme(authCtx: AuthContext): Promise<GradingSchemeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const scheme = await db.gradingScheme.findFirst({ select: SCHEME_SELECT });
      if (!scheme) throw new NotFoundError("Grading scheme not found.");
      return toSchemeDto(scheme);
    });
  }

  async updateScheme(
    authCtx: AuthContext,
    input: UpdateGradingSchemeInput,
    reqCtx: RequestContext,
  ): Promise<GradingSchemeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const scheme = await db.gradingScheme.findFirst({ select: { id: true } });
      if (!scheme) throw new NotFoundError("Grading scheme not found.");

      const data: Prisma.GradingSchemeUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      const updated = await db.gradingScheme.update({
        where: { id: scheme.id },
        data,
        select: SCHEME_SELECT,
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.schemeUpdate, "grading_scheme", scheme.id, {
        changed: Object.keys(data),
      });

      return toSchemeDto(updated);
    });
  }

  // =========================================================================
  // Components
  // =========================================================================

  async listComponents(authCtx: AuthContext): Promise<GradingComponentDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.gradingComponent.findMany({
        select: COMPONENT_SELECT,
        orderBy: { orderIndex: "asc" },
      });
      return rows.map(toComponentDto);
    });
  }

  async createComponent(
    authCtx: AuthContext,
    input: CreateGradingComponentInput,
    reqCtx: RequestContext,
  ): Promise<GradingComponentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertSchemeNotFrozen(db);
      const scheme = await this.requireSchemeId(db);

      let created;
      try {
        created = await db.gradingComponent.create({
          data: {
            schoolId: authCtx.schoolId,
            schemeId: scheme,
            key: input.key,
            label: input.label,
            weight: input.weight,
            orderIndex: input.orderIndex,
          },
          select: COMPONENT_SELECT,
        });
      } catch (e) {
        throw mapDuplicateKey(e);
      }

      // Re-validate the WHOLE set; a throw rolls the create back.
      await this.assertWeightsValid(db);

      await this.writeAudit(
        db,
        authCtx,
        reqCtx,
        AUDIT.componentCreate,
        "grading_component",
        created.id,
        { key: created.key },
      );

      return toComponentDto(created);
    });
  }

  async updateComponent(
    authCtx: AuthContext,
    id: string,
    input: UpdateGradingComponentInput,
    reqCtx: RequestContext,
  ): Promise<GradingComponentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertSchemeNotFrozen(db);
      const existing = await db.gradingComponent.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Grading component not found.");

      const data: Prisma.GradingComponentUpdateInput = {};
      if (input.key !== undefined) data.key = input.key;
      if (input.label !== undefined) data.label = input.label;
      if (input.weight !== undefined) data.weight = input.weight;
      if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;

      let updated;
      try {
        updated = await db.gradingComponent.update({
          where: { id },
          data,
          select: COMPONENT_SELECT,
        });
      } catch (e) {
        throw mapDuplicateKey(e);
      }

      await this.assertWeightsValid(db);

      await this.writeAudit(
        db,
        authCtx,
        reqCtx,
        AUDIT.componentUpdate,
        "grading_component",
        id,
        { changed: Object.keys(data) },
      );

      return toComponentDto(updated);
    });
  }

  async deleteComponent(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    await withTenant(authCtx.schoolId, async (db) => {
      await this.assertSchemeNotFrozen(db);
      const existing = await db.gradingComponent.findUnique({
        where: { id },
        select: { id: true, key: true },
      });
      if (!existing) throw new NotFoundError("Grading component not found.");

      await db.gradingComponent.delete({ where: { id } });

      // Removing a component usually breaks the sum — reject (and roll back)
      // unless the remaining set still totals 100.
      await this.assertWeightsValid(db);

      await this.writeAudit(
        db,
        authCtx,
        reqCtx,
        AUDIT.componentDelete,
        "grading_component",
        id,
        { key: existing.key },
      );
    });
  }

  // Bulk replace — the settings UI save path and the only safe way to edit
  // weights (the sum-to-100 invariant is over the whole set). Delete-then-
  // recreate inside one tenant transaction.
  async replaceComponents(
    authCtx: AuthContext,
    input: ReplaceGradingComponentsInput,
    reqCtx: RequestContext,
  ): Promise<GradingSchemeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertSchemeNotFrozen(db);
      const schemeId = await this.requireSchemeId(db);

      await db.gradingComponent.deleteMany({ where: { schemeId } });
      await db.gradingComponent.createMany({
        data: input.components.map((c) => ({
          schoolId: authCtx.schoolId,
          schemeId,
          key: c.key,
          label: c.label,
          weight: c.weight,
          orderIndex: c.orderIndex,
        })),
      });

      // The DTO refine already enforced Σ=100, but re-check at the service
      // edge so the invariant holds even if this method is ever called from a
      // path that skipped the pipe.
      await this.assertWeightsValid(db);

      const scheme = await db.gradingScheme.findUniqueOrThrow({
        where: { id: schemeId },
        select: SCHEME_SELECT,
      });

      await this.writeAudit(
        db,
        authCtx,
        reqCtx,
        AUDIT.componentUpdate,
        "grading_scheme",
        schemeId,
        { bulk: true, count: input.components.length },
      );

      return toSchemeDto(scheme);
    });
  }

  // =========================================================================
  // Boundaries
  // =========================================================================

  async listBoundaries(authCtx: AuthContext): Promise<GradeBoundaryDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.gradeBoundary.findMany({
        select: BOUNDARY_SELECT,
        orderBy: { orderIndex: "asc" },
      });
      return rows.map(toBoundaryDto);
    });
  }

  async updateBoundary(
    authCtx: AuthContext,
    id: string,
    input: UpdateGradeBoundaryInput,
    reqCtx: RequestContext,
  ): Promise<GradeBoundaryDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.gradeBoundary.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Grade boundary not found.");

      const data: Prisma.GradeBoundaryUpdateInput = {};
      if (input.letter !== undefined) data.letter = input.letter;
      if (input.minScore !== undefined) data.minScore = input.minScore;
      if (input.maxScore !== undefined) data.maxScore = input.maxScore;
      if (input.remark !== undefined) data.remark = input.remark;
      if (input.orderIndex !== undefined) data.orderIndex = input.orderIndex;

      let updated;
      try {
        updated = await db.gradeBoundary.update({
          where: { id },
          data,
          select: BOUNDARY_SELECT,
        });
      } catch (e) {
        throw mapDuplicateLetter(e);
      }

      await this.assertBoundariesValid(db);

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.boundaryUpdate, "grade_boundary", id, {
        changed: Object.keys(data),
      });

      return toBoundaryDto(updated);
    });
  }

  async replaceBoundaries(
    authCtx: AuthContext,
    input: ReplaceGradeBoundariesInput,
    reqCtx: RequestContext,
  ): Promise<GradeBoundaryDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await db.gradeBoundary.deleteMany({});
      await db.gradeBoundary.createMany({
        data: input.boundaries.map((b) => ({
          schoolId: authCtx.schoolId,
          letter: b.letter,
          minScore: b.minScore,
          maxScore: b.maxScore,
          remark: b.remark ?? null,
          orderIndex: b.orderIndex,
        })),
      });

      await this.assertBoundariesValid(db);

      const rows = await db.gradeBoundary.findMany({
        select: BOUNDARY_SELECT,
        orderBy: { orderIndex: "asc" },
      });

      await this.writeAudit(
        db,
        authCtx,
        reqCtx,
        AUDIT.boundaryUpdate,
        "grade_boundary",
        rows[0]?.id ?? authCtx.schoolId,
        { bulk: true, count: input.boundaries.length },
      );

      return rows.map(toBoundaryDto);
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  // Resolve the school's single scheme id (one per school by construction).
  private async requireSchemeId(db: TenantDb): Promise<string> {
    const scheme = await db.gradingScheme.findFirst({ select: { id: true } });
    if (!scheme) throw new NotFoundError("Grading scheme not found.");
    return scheme.id;
  }

  // FREEZE GUARD (Phase 2 / Slice 2 cp3 — phase-2.md "score aggregation
  // cascading wrong if GradingComponent.weight changes mid-term"). Once ANY
  // assessment_score exists for the school, the component set is frozen: editing
  // a weight or adding/removing a component would silently corrupt every
  // already-materialized total. The invariant is deliberately SCHOOL-WIDE and
  // conservative (not "active term only") to categorically prevent the
  // retroactive-recompute footgun. A fast existence check (findFirst, indexed on
  // school_id) — RLS scopes it to this school, so one school's scores never
  // freeze another's scheme. Boundary edits are NOT affected (they change letter
  // resolution, not score validation). The audited "reset scores" unfreeze path
  // is deferred (see docs/deferred.md).
  private async assertSchemeNotFrozen(db: TenantDb): Promise<void> {
    const anyScore = await db.assessmentScore.findFirst({ select: { id: true } });
    if (anyScore) {
      throw new ValidationError(
        "This scheme is frozen because scores have been entered. To change the scheme, an admin must reset scores first (audited).",
        { issues: [{ path: "components", code: "scheme_frozen", message: "Scheme is frozen — scores exist." }] },
      );
    }
  }

  // Whole-set weight invariant. Throws ValidationError (rolling back the
  // surrounding transaction) when the components do not sum to 100.
  private async assertWeightsValid(db: TenantDb): Promise<void> {
    const components = await db.gradingComponent.findMany({ select: { weight: true } });
    const error = findWeightSumError(components.map((c) => c.weight));
    if (error) {
      throw new ValidationError(error, {
        issues: [{ path: "components", code: "weights_sum", message: error }],
      });
    }
  }

  // Whole-set boundary tiling invariant. Throws ValidationError on gap/overlap/
  // out-of-range, rolling back the surrounding transaction.
  private async assertBoundariesValid(db: TenantDb): Promise<void> {
    const bands = await db.gradeBoundary.findMany({
      select: { minScore: true, maxScore: true },
    });
    const error = findBoundaryTilingError(bands);
    if (error) {
      throw new ValidationError(error, {
        issues: [{ path: "boundaries", code: "boundary_tiling", message: error }],
      });
    }
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType,
        entityId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}

// -------------------------------------------------------------------------
// Selects + mappers
// -------------------------------------------------------------------------

const COMPONENT_SELECT = {
  id: true,
  schemeId: true,
  key: true,
  label: true,
  weight: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GradingComponentSelect;

const SCHEME_SELECT = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  components: {
    select: COMPONENT_SELECT,
    orderBy: { orderIndex: "asc" },
  },
} satisfies Prisma.GradingSchemeSelect;

const BOUNDARY_SELECT = {
  id: true,
  letter: true,
  minScore: true,
  maxScore: true,
  remark: true,
  orderIndex: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GradeBoundarySelect;

type ComponentRow = Prisma.GradingComponentGetPayload<{ select: typeof COMPONENT_SELECT }>;
type SchemeRow = Prisma.GradingSchemeGetPayload<{ select: typeof SCHEME_SELECT }>;
type BoundaryRow = Prisma.GradeBoundaryGetPayload<{ select: typeof BOUNDARY_SELECT }>;

function toComponentDto(row: ComponentRow): GradingComponentDto {
  return {
    id: row.id,
    schemeId: row.schemeId,
    key: row.key,
    label: row.label,
    weight: row.weight,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSchemeDto(row: SchemeRow): GradingSchemeDto {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    components: row.components.map(toComponentDto),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toBoundaryDto(row: BoundaryRow): GradeBoundaryDto {
  return {
    id: row.id,
    letter: row.letter,
    minScore: row.minScore,
    maxScore: row.maxScore,
    remark: row.remark,
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// A duplicate component key (school_id, scheme_id, key) collides — surface a
// clean ValidationError instead of a raw P2002. Under FORCE RLS the constraint
// name is stripped, so we map any P2002 here to the key field.
function mapDuplicateKey(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ValidationError("A component with that key already exists.", {
      issues: [{ path: "key", code: "duplicate", message: "Component key already exists." }],
    });
  }
  return e;
}

function mapDuplicateLetter(e: unknown): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return new ValidationError("A boundary with that letter already exists.", {
      issues: [{ path: "letter", code: "duplicate", message: "Grade letter already exists." }],
    });
  }
  return e;
}
