import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  type CreateExpenseInput,
  type ExpenseDto,
  type ExpenseReceiptUrlDto,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { StorageService } from "../../common/storage/storage.service.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "expense.create",
  update: "expense.update",
  delete: "expense.delete",
  receiptUpload: "expense.receipt-upload",
} as const;

// 8 MB, not the CSV module's 5 MB — a receipt is a phone-camera photo of a
// paper receipt or a scanned invoice, routinely larger than a CSV payload.
export const EXPENSE_RECEIPT_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

export const EXPENSE_RECEIPT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

const RECEIPT_URL_TTL_SECONDS = 15 * 60; // mirrors PaymentsService's receipt TTL

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
  constructor(private readonly storage: StorageService) {}

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

  // storage.delete() is idempotent (no-op if nothing was ever uploaded), so
  // this runs unconditionally rather than branching on receiptUrl.
  async delete(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<void> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expense.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Expense not found.");

      await db.expense.delete({ where: { id } });
      await this.storage.delete(authCtx.schoolId, { kind: "expense-receipt", expenseId: id });

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

  async uploadReceipt(
    authCtx: AuthContext,
    id: string,
    file: { buffer: Buffer; mimetype: string },
    reqCtx: RequestContext,
  ): Promise<ExpenseDto> {
    if (!EXPENSE_RECEIPT_ALLOWED_MIME_TYPES.includes(
      file.mimetype as (typeof EXPENSE_RECEIPT_ALLOWED_MIME_TYPES)[number],
    )) {
      throw new ValidationError(
        "INVALID_RECEIPT_TYPE",
        `Receipt must be one of: ${EXPENSE_RECEIPT_ALLOWED_MIME_TYPES.join(", ")}.`,
      );
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.expense.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("Expense not found.");

      // Re-uploading replaces the previous file (delete-then-put, not
      // append) — no separate "remove receipt" endpoint. pathFor() derives
      // the same extensionless key every time, so put() naturally overwrites.
      const receiptUrl = await this.storage.put(
        authCtx.schoolId,
        { kind: "expense-receipt", expenseId: id },
        file.buffer,
        file.mimetype,
      );

      const updated = await db.expense.update({
        where: { id },
        data: { receiptUrl },
        select: EXPENSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.receiptUpload,
          entityType: "expense",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { mimetype: file.mimetype, size: file.buffer.length },
        },
      });

      return toDto(updated);
    });
  }

  async getReceiptUrl(authCtx: AuthContext, id: string): Promise<ExpenseReceiptUrlDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.expense.findUnique({
        where: { id },
        select: { id: true, receiptUrl: true },
      });
      if (!row) throw new NotFoundError("Expense not found.");
      if (!row.receiptUrl) {
        throw new NotFoundError("No receipt has been uploaded for this expense.");
      }

      const url = await this.storage.signUrl(
        authCtx.schoolId,
        { kind: "expense-receipt", expenseId: id },
        RECEIPT_URL_TTL_SECONDS,
      );
      return { url, expiresAt: new Date(Date.now() + RECEIPT_URL_TTL_SECONDS * 1000) };
    });
  }
}
