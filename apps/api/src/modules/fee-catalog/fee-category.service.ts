import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateFeeCategoryInput,
  type FeeCategoryDto,
  type UpdateFeeCategoryInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "fee-category.create",
  update: "fee-category.update",
  delete: "fee-category.delete",
} as const;

const FEE_CATEGORY_SELECT = {
  id: true,
  schoolId: true,
  name: true,
  description: true,
  active: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { feeItems: true } },
} as const;

type FeeCategoryRow = {
  id: string;
  schoolId: string;
  name: string;
  description: string | null;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { feeItems: number };
};

function toDto(row: FeeCategoryRow): FeeCategoryDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    description: row.description,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    itemCount: row._count.feeItems,
  };
}

@Injectable()
export class FeeCategoryService {
  async findAll(
    authCtx: AuthContext,
    options: { includeInactive?: boolean } = {},
  ): Promise<FeeCategoryDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.feeCategory.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(options.includeInactive ? {} : { active: true }),
        },
        select: FEE_CATEGORY_SELECT,
        orderBy: { name: "asc" },
      });
      return rows.map(toDto);
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<FeeCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.feeCategory.findUnique({
        where: { id },
        select: FEE_CATEGORY_SELECT,
      });
      if (!row) throw new NotFoundError("Fee category not found.");
      return toDto(row);
    });
  }

  async create(
    authCtx: AuthContext,
    dto: CreateFeeCategoryInput,
    reqCtx: RequestContext,
  ): Promise<FeeCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.feeCategory.findUnique({
        where: { schoolId_name: { schoolId: authCtx.schoolId, name: dto.name } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError(
          "FEE_CATEGORY_NAME_TAKEN",
          `A fee category named "${dto.name}" already exists in this school.`,
        );
      }

      const created = await db.feeCategory.create({
        data: {
          schoolId: authCtx.schoolId,
          name: dto.name,
          description: dto.description ?? null,
          createdBy: authCtx.userId,
        },
        select: FEE_CATEGORY_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "fee_category",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: created.name },
        },
      });

      return toDto(created);
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdateFeeCategoryInput,
    reqCtx: RequestContext,
  ): Promise<FeeCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.feeCategory.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundError("Fee category not found.");

      // Name-uniqueness check only if the name is actually changing.
      if (dto.name !== undefined && dto.name !== existing.name) {
        const conflict = await db.feeCategory.findUnique({
          where: { schoolId_name: { schoolId: authCtx.schoolId, name: dto.name } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictError(
            "FEE_CATEGORY_NAME_TAKEN",
            `A fee category named "${dto.name}" already exists in this school.`,
          );
        }
      }

      const updated = await db.feeCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: FEE_CATEGORY_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "fee_category",
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
      const existing = await db.feeCategory.findUnique({
        where: { id },
        select: { id: true, name: true, _count: { select: { feeItems: true } } },
      });
      if (!existing) throw new NotFoundError("Fee category not found.");

      if (existing._count.feeItems > 0) {
        throw new ValidationError(
          "FEE_CATEGORY_HAS_ITEMS",
          `Cannot delete "${existing.name}" — it has ${existing._count.feeItems} fee item(s). Deactivate or remove the items first.`,
        );
      }

      await db.feeCategory.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "fee_category",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: existing.name },
        },
      });
    });
  }
}
