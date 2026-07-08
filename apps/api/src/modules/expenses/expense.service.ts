import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  type CreateExpenseInput,
  type ExpenseDto,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "expense.create",
  update: "expense.update",
  delete: "expense.delete",
} as const;

const EXPENSE_SELECT = {
  id: true,
  schoolId: true,
  categoryId: true,
  amount: true,
  description: true,
  incurredAt: true,
  receiptUrl: true,
  recordedBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

type ExpenseRow = {
  id: string;
  schoolId: string;
  categoryId: string;
  amount: number;
  description: string | null;
  incurredAt: Date;
  receiptUrl: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: ExpenseRow): ExpenseDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    categoryId: row.categoryId,
    amount: row.amount,
    description: row.description,
    incurredAt: row.incurredAt,
    receiptUrl: row.receiptUrl,
    recordedBy: row.recordedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class ExpenseService {
  async findAll(authCtx: AuthContext, query: ListExpensesQuery = {}): Promise<ExpenseDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.expense.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.from || query.to
            ? {
                incurredAt: {
                  ...(query.from ? { gte: new Date(query.from) } : {}),
                  ...(query.to ? { lte: new Date(query.to) } : {}),
                },
              }
            : {}),
        },
        select: EXPENSE_SELECT,
        orderBy: { incurredAt: "desc" },
      });
      return rows.map(toDto);
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<ExpenseDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.expense.findUnique({
        where: { id },
        select: EXPENSE_SELECT,
      });
      if (!row) throw new NotFoundError("Expense not found.");
      return toDto(row);
    });
  }

  // categoryId has no DB-level FK (plain FK convention — see the schema.prisma
  // header comment on Expense), so this pre-check is the ONLY thing standing
  // between a create/update and a silently dangling category reference.
  private async assertCategoryExists(
    db: PrismaClient,
    schoolId: string,
    categoryId: string,
  ): Promise<void> {
    const category = await db.expenseCategory.findUnique({
      where: { id: categoryId },
      select: { id: true, schoolId: true },
    });
    if (!category || category.schoolId !== schoolId) {
      throw new NotFoundError("Expense category not found.");
    }
  }

  async create(
    authCtx: AuthContext,
    dto: CreateExpenseInput,
    reqCtx: RequestContext,
  ): Promise<ExpenseDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCategoryExists(db, authCtx.schoolId, dto.categoryId);

      const created = await db.expense.create({
        data: {
          schoolId: authCtx.schoolId,
          categoryId: dto.categoryId,
          amount: dto.amount,
          description: dto.description ?? null,
          incurredAt: new Date(dto.incurredAt),
          recordedBy: authCtx.userId,
        },
        select: EXPENSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "expense",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { categoryId: created.categoryId, amount: created.amount },
        },
      });

      return toDto(created);
    });
  }

  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdateExpenseInput,
    reqCtx: RequestContext,
  ): Promise<ExpenseDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expense.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Expense not found.");

      if (dto.categoryId !== undefined) {
        await this.assertCategoryExists(db, authCtx.schoolId, dto.categoryId);
      }

      const updated = await db.expense.update({
        where: { id },
        data: {
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.incurredAt !== undefined ? { incurredAt: new Date(dto.incurredAt) } : {}),
        },
        select: EXPENSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "expense",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: dto,
        },
      });

      return toDto(updated);
    });
  }

  // Receipt-blob cleanup on delete is wired in CP2 alongside the upload
  // endpoint (StorageService isn't injected here yet — in CP1, receiptUrl is
  // always null, since no upload path exists to set it).
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expense.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Expense not found.");

      await db.expense.delete({ where: { id } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "expense",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });
    });
  }
}
