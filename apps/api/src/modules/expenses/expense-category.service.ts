import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CreateExpenseCategoryInput,
  type ExpenseCategoryDto,
  type UpdateExpenseCategoryInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "expense-category.create",
  update: "expense-category.update",
  delete: "expense-category.delete",
} as const;

const EXPENSE_CATEGORY_SELECT = {
  id: true,
  schoolId: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ExpenseCategoryRow = {
  id: string;
  schoolId: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: ExpenseCategoryRow, expenseCount?: number): ExpenseCategoryDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(expenseCount !== undefined ? { expenseCount } : {}),
  };
}

@Injectable()
export class ExpenseCategoryService {
  // categoryId is a plain FK on Expense (no Prisma relation — see the
  // schema.prisma header comment on the Expense model), so there is no
  // `_count` relation shorthand available here. Every read that wants an
  // expense count runs this explicit query per category.
  async findAll(
    authCtx: AuthContext,
    options: { includeInactive?: boolean } = {},
  ): Promise<ExpenseCategoryDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.expenseCategory.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(options.includeInactive ? {} : { active: true }),
        },
        select: EXPENSE_CATEGORY_SELECT,
        orderBy: { name: "asc" },
      });
      const counts = await Promise.all(
        rows.map((row) => db.expense.count({ where: { categoryId: row.id } })),
      );
      return rows.map((row, i) => toDto(row, counts[i]));
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<ExpenseCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.expenseCategory.findUnique({
        where: { id },
        select: EXPENSE_CATEGORY_SELECT,
      });
      if (!row) throw new NotFoundError("Expense category not found.");
      const expenseCount = await db.expense.count({ where: { categoryId: id } });
      return toDto(row, expenseCount);
    });
  }

  async create(
    authCtx: AuthContext,
    dto: CreateExpenseCategoryInput,
    reqCtx: RequestContext,
  ): Promise<ExpenseCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expenseCategory.findUnique({
        where: { schoolId_name: { schoolId: authCtx.schoolId, name: dto.name } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError(
          "EXPENSE_CATEGORY_NAME_TAKEN",
          `An expense category named "${dto.name}" already exists in this school.`,
        );
      }

      const created = await db.expenseCategory.create({
        data: {
          schoolId: authCtx.schoolId,
          name: dto.name,
        },
        select: EXPENSE_CATEGORY_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "expense_category",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: created.name },
        },
      });

      return toDto(created, 0);
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdateExpenseCategoryInput,
    reqCtx: RequestContext,
  ): Promise<ExpenseCategoryDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expenseCategory.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundError("Expense category not found.");

      if (dto.name !== undefined && dto.name !== existing.name) {
        const conflict = await db.expenseCategory.findUnique({
          where: { schoolId_name: { schoolId: authCtx.schoolId, name: dto.name } },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictError(
            "EXPENSE_CATEGORY_NAME_TAKEN",
            `An expense category named "${dto.name}" already exists in this school.`,
          );
        }
      }

      const updated = await db.expenseCategory.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
        select: EXPENSE_CATEGORY_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "expense_category",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: dto,
        },
      });

      const expenseCount = await db.expense.count({ where: { categoryId: id } });
      return toDto(updated, expenseCount);
    });
  }

  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expenseCategory.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!existing) throw new NotFoundError("Expense category not found.");

      const expenseCount = await db.expense.count({ where: { categoryId: id } });
      if (expenseCount > 0) {
        throw new ValidationError(
          "EXPENSE_CATEGORY_HAS_EXPENSES",
          `Cannot delete "${existing.name}" — it has ${expenseCount} expense(s). Deactivate it or reassign/remove the expenses first.`,
        );
      }

      await db.expenseCategory.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "expense_category",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { name: existing.name },
        },
      });
    });
  }
}
