import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type CreateFeeItemInput,
  type FeeItemDto,
  type UpdateFeeItemInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "fee-item.create",
  update: "fee-item.update",
  delete: "fee-item.delete",
} as const;

const FEE_ITEM_SELECT = {
  id: true,
  schoolId: true,
  categoryId: true,
  name: true,
  amount: true,
  classLevelId: true,
  classArmId: true,
  termId: true,
  academicYearId: true,
  active: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

type FeeItemRow = {
  id: string;
  schoolId: string;
  categoryId: string;
  name: string;
  amount: number;
  classLevelId: string | null;
  classArmId: string | null;
  termId: string | null;
  academicYearId: string | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: FeeItemRow): FeeItemDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    categoryId: row.categoryId,
    name: row.name,
    amount: row.amount,
    classLevelId: row.classLevelId,
    classArmId: row.classArmId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class FeeItemService {
  async findAll(
    authCtx: AuthContext,
    options: {
      categoryId?: string;
      includeInactive?: boolean;
    } = {},
  ): Promise<FeeItemDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.feeItem.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(options.categoryId ? { categoryId: options.categoryId } : {}),
          ...(options.includeInactive ? {} : { active: true }),
        },
        select: FEE_ITEM_SELECT,
        orderBy: [{ categoryId: "asc" }, { name: "asc" }],
      });
      return rows.map(toDto);
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<FeeItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.feeItem.findUnique({
        where: { id },
        select: FEE_ITEM_SELECT,
      });
      if (!row) throw new NotFoundError("Fee item not found.");
      return toDto(row);
    });
  }

  async create(
    authCtx: AuthContext,
    dto: CreateFeeItemInput,
    reqCtx: RequestContext,
  ): Promise<FeeItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      // Verify category belongs to this school.
      const category = await db.feeCategory.findUnique({
        where: { id: dto.categoryId },
        select: { id: true, schoolId: true },
      });
      if (!category || category.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Fee category not found.");
      }

      await validateScopeIds(db, authCtx.schoolId, {
        classLevelId: dto.classLevelId ?? null,
        classArmId: dto.classArmId ?? null,
        termId: dto.termId ?? null,
        academicYearId: dto.academicYearId ?? null,
      });

      const created = await db.feeItem.create({
        data: {
          schoolId: authCtx.schoolId,
          categoryId: dto.categoryId,
          name: dto.name,
          amount: dto.amount,
          classLevelId: dto.classLevelId ?? null,
          classArmId: dto.classArmId ?? null,
          termId: dto.termId ?? null,
          academicYearId: dto.academicYearId ?? null,
          createdBy: authCtx.userId,
        },
        select: FEE_ITEM_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "fee_item",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: created.name, amount: created.amount, categoryId: created.categoryId },
        },
      });

      return toDto(created);
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdateFeeItemInput,
    reqCtx: RequestContext,
  ): Promise<FeeItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.feeItem.findUnique({
        where: { id },
        select: {
          id: true,
          schoolId: true,
          classLevelId: true,
          classArmId: true,
        },
      });
      if (!existing) throw new NotFoundError("Fee item not found.");

      // Merge the update onto the existing scope to validate the combined state.
      const mergedClassLevelId =
        dto.classLevelId !== undefined ? dto.classLevelId : existing.classLevelId;
      const mergedClassArmId =
        dto.classArmId !== undefined ? dto.classArmId : existing.classArmId;

      // Arm-without-level invariant on the merged state.
      if (mergedClassArmId && !mergedClassLevelId) {
        throw new ValidationError(
          "SCOPE_INVARIANT",
          "classArmId cannot remain set when classLevelId is cleared.",
        );
      }

      await validateScopeIds(db, authCtx.schoolId, {
        classLevelId: mergedClassLevelId,
        classArmId: mergedClassArmId,
        // Only validate scope IDs that are being actively changed.
        termId: dto.termId !== undefined ? dto.termId : null,
        academicYearId: dto.academicYearId !== undefined ? dto.academicYearId : null,
      });

      const updated = await db.feeItem.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.classLevelId !== undefined ? { classLevelId: dto.classLevelId } : {}),
          ...(dto.classArmId !== undefined ? { classArmId: dto.classArmId } : {}),
          ...(dto.termId !== undefined ? { termId: dto.termId } : {}),
          ...(dto.academicYearId !== undefined ? { academicYearId: dto.academicYearId } : {}),
        },
        select: FEE_ITEM_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "fee_item",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: dto,
        },
      });

      return toDto(updated);
    });
  }

  async delete(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.feeItem.findUnique({
        where: { id },
        select: { id: true, name: true, schoolId: true },
      });
      if (!existing) throw new NotFoundError("Fee item not found.");

      await db.feeItem.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "fee_item",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: existing.name },
        },
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Scope validation helper — verifies that every non-null scope ID exists in
// the school. classArmId is additionally verified to belong to classLevelId.
// Called by both create and update so the merged state is always checked.
// ---------------------------------------------------------------------------
async function validateScopeIds(
  db: PrismaClient,
  schoolId: string,
  scope: {
    classLevelId: string | null | undefined;
    classArmId: string | null | undefined;
    termId: string | null | undefined;
    academicYearId: string | null | undefined;
  },
): Promise<void> {
  if (scope.classLevelId) {
    const level = await db.classLevel.findUnique({
      where: { id: scope.classLevelId },
      select: { id: true, schoolId: true },
    });
    if (!level || level.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "classLevelId not found in this school.");
    }
  }

  if (scope.classArmId) {
    const arm = await db.classArm.findUnique({
      where: { id: scope.classArmId },
      select: { id: true, schoolId: true, classLevelId: true },
    });
    if (!arm || arm.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "classArmId not found in this school.");
    }
    if (scope.classLevelId && arm.classLevelId !== scope.classLevelId) {
      throw new ValidationError(
        "SCOPE_MISMATCH",
        "classArmId does not belong to the specified classLevelId.",
      );
    }
  }

  if (scope.termId) {
    const term = await db.term.findUnique({
      where: { id: scope.termId },
      select: { id: true, schoolId: true },
    });
    if (!term || term.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "termId not found in this school.");
    }
  }

  if (scope.academicYearId) {
    const year = await db.academicYear.findUnique({
      where: { id: scope.academicYearId },
      select: { id: true, schoolId: true },
    });
    if (!year || year.schoolId !== schoolId) {
      throw new ValidationError("SCOPE_NOT_FOUND", "academicYearId not found in this school.");
    }
  }
}
