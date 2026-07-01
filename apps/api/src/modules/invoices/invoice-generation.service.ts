import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type GenerateInvoicesInput,
  type GenerateInvoicesResponseDto,
  type InvoiceDto,
  type InvoiceLineItemDto,
  type InvoiceStatus,
  type ListInvoicesInput,
  type PaginatedInvoicesDto,
  type PreviewInvoicesInput,
  type PreviewLineDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import {
  buildSnapshot,
  type DiscountRuleForSnapshot,
  type FeeItemForSnapshot,
} from "./invoice-snapshot.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  issue: "invoice.issue",
  cancel: "invoice.cancel",
} as const;

interface ArmContext {
  classLevelId: string;
}

interface TermContext {
  academicYearId: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class InvoiceGenerationService {
  // ─── Generate ──────────────────────────────────────────────────────────────

  async generateForArm(
    authCtx: AuthContext,
    dto: GenerateInvoicesInput,
    reqCtx: RequestContext,
  ): Promise<GenerateInvoicesResponseDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await this.fetchArm(db, authCtx.schoolId, dto.classArmId);
      const term = await this.fetchTerm(db, authCtx.schoolId, dto.termId);

      const enrollments = await db.enrollment.findMany({
        where: {
          schoolId: authCtx.schoolId,
          classArmId: dto.classArmId,
          termId: dto.termId,
          status: "ENROLLED",
        },
        select: { studentId: true },
      });

      if (enrollments.length === 0) {
        return { created: 0, skipped: 0, invoices: [] };
      }

      const feeItems = await this.fetchFeeItems(
        db,
        authCtx.schoolId,
        arm.classLevelId,
        dto.classArmId,
        dto.termId,
        term.academicYearId,
      );

      const issuedAt = new Date();
      const created: InvoiceDto[] = [];
      let skipped = 0;

      for (const { studentId } of enrollments) {
        // Skip if an invoice already exists for this student-term pair.
        const existing = await db.invoice.findUnique({
          where: {
            schoolId_studentId_termId: {
              schoolId: authCtx.schoolId,
              studentId,
              termId: dto.termId,
            },
          },
          select: { id: true },
        });
        if (existing) {
          skipped += 1;
          continue;
        }

        const discountRules = await this.fetchDiscountRules(
          db,
          authCtx.schoolId,
          studentId,
          dto.termId,
          term.academicYearId,
        );

        const snapshot = buildSnapshot(feeItems, discountRules);

        const invoice = await db.invoice.create({
          data: {
            schoolId: authCtx.schoolId,
            studentId,
            termId: dto.termId,
            academicYearId: term.academicYearId,
            status: "ISSUED",
            items: snapshot.items as object[],
            totalAmount: snapshot.totalAmount,
            totalDiscount: snapshot.totalDiscount,
            totalDue: snapshot.totalDue,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
            issuedAt,
            issuedBy: authCtx.userId,
          },
        });

        // audit_logs has FORCE RLS — basePrisma without the school GUC set would be
        // blocked. All audit writes in this service must go through withTenant.
        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.issue,
            entityType: "invoice",
            entityId: invoice.id,
            ipAddress: reqCtx.ipAddress,
            metadata: {
              studentId,
              termId: dto.termId,
              totalAmount: snapshot.totalAmount,
              totalDiscount: snapshot.totalDiscount,
              totalDue: snapshot.totalDue,
            },
          },
        });

        created.push(toDto(invoice, snapshot.items));
      }

      return { created: created.length, skipped, invoices: created };
    });
  }

  // ─── Preview (dry-run — no persistence) ────────────────────────────────────

  async previewForArm(
    authCtx: AuthContext,
    dto: PreviewInvoicesInput,
  ): Promise<PreviewLineDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const arm = await this.fetchArm(db, authCtx.schoolId, dto.classArmId);
      const term = await this.fetchTerm(db, authCtx.schoolId, dto.termId);

      const enrollments = await db.enrollment.findMany({
        where: {
          schoolId: authCtx.schoolId,
          classArmId: dto.classArmId,
          termId: dto.termId,
          status: "ENROLLED",
        },
        select: { studentId: true },
      });

      const feeItems = await this.fetchFeeItems(
        db,
        authCtx.schoolId,
        arm.classLevelId,
        dto.classArmId,
        dto.termId,
        term.academicYearId,
      );

      const previews: PreviewLineDto[] = [];
      for (const { studentId } of enrollments) {
        const discountRules = await this.fetchDiscountRules(
          db,
          authCtx.schoolId,
          studentId,
          dto.termId,
          term.academicYearId,
        );
        const snapshot = buildSnapshot(feeItems, discountRules);
        previews.push({
          studentId,
          feeItemCount: feeItems.length,
          totalAmount: snapshot.totalAmount,
          totalDiscount: snapshot.totalDiscount,
          totalDue: snapshot.totalDue,
        });
      }

      return previews;
    });
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  async findById(authCtx: AuthContext, id: string): Promise<InvoiceDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.invoice.findUnique({ where: { id } });
      if (!row) throw new NotFoundError("Invoice not found.");
      return toDto(row, row.items as unknown as InvoiceLineItemDto[]);
    });
  }

  async findAll(authCtx: AuthContext, query: ListInvoicesInput): Promise<PaginatedInvoicesDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const where = {
        schoolId: authCtx.schoolId,
        ...(query.termId ? { termId: query.termId } : {}),
        ...(query.studentId ? { studentId: query.studentId } : {}),
        ...(query.status ? { status: query.status } : {}),
      };

      const [rows, total] = await Promise.all([
        db.invoice.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        db.invoice.count({ where }),
      ]);

      return {
        data: rows.map((r) => toDto(r, r.items as unknown as InvoiceLineItemDto[])),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  async cancel(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<InvoiceDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.invoice.findUnique({ where: { id } });
      if (!row) throw new NotFoundError("Invoice not found.");

      if (row.status === "PARTIALLY_PAID" || row.status === "PAID") {
        throw new ConflictError(
          "INVOICE_HAS_PAYMENTS",
          "Cannot cancel an invoice that has recorded payments.",
        );
      }
      if (row.status === "CANCELLED") {
        throw new ConflictError("INVOICE_ALREADY_CANCELLED", "Invoice is already cancelled.");
      }
      if (row.status === "REFUNDED") {
        throw new ConflictError("INVOICE_REFUNDED", "Cannot cancel a refunded invoice.");
      }

      const updated = await db.invoice.update({
        where: { id },
        data: { status: "CANCELLED" },
      });

      // audit_logs has FORCE RLS — basePrisma without the school GUC set would be
      // blocked. All audit writes in this service must go through withTenant.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.cancel,
          entityType: "invoice",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { previousStatus: row.status },
        },
      });

      return toDto(updated, updated.items as unknown as InvoiceLineItemDto[]);
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async fetchArm(
    db: PrismaClient,
    schoolId: string,
    classArmId: string,
  ): Promise<ArmContext> {
    const arm = await db.classArm.findUnique({
      where: { id: classArmId },
      select: { classLevelId: true, schoolId: true },
    });
    if (!arm || arm.schoolId !== schoolId) {
      throw new NotFoundError("Class arm not found.");
    }
    return { classLevelId: arm.classLevelId };
  }

  private async fetchTerm(
    db: PrismaClient,
    schoolId: string,
    termId: string,
  ): Promise<TermContext> {
    const term = await db.term.findUnique({
      where: { id: termId },
      select: { academicYearId: true, schoolId: true },
    });
    if (!term || term.schoolId !== schoolId) {
      throw new NotFoundError("Term not found.");
    }
    return { academicYearId: term.academicYearId };
  }

  private async fetchFeeItems(
    db: PrismaClient,
    schoolId: string,
    classLevelId: string,
    classArmId: string,
    termId: string,
    academicYearId: string,
  ): Promise<FeeItemForSnapshot[]> {
    const rows = await db.feeItem.findMany({
      where: {
        schoolId,
        active: true,
        // Null scope field means "applies to all" — match both null and specific value.
        AND: [
          { OR: [{ classLevelId: null }, { classLevelId }] },
          { OR: [{ classArmId: null }, { classArmId }] },
          { OR: [{ termId: null }, { termId }] },
          { OR: [{ academicYearId: null }, { academicYearId }] },
        ],
      },
      select: {
        id: true,
        name: true,
        amount: true,
        categoryId: true,
        category: { select: { name: true } },
      },
      orderBy: [{ categoryId: "asc" }, { name: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      amount: r.amount,
      categoryId: r.categoryId,
      categoryName: r.category.name,
    }));
  }

  private async fetchDiscountRules(
    db: PrismaClient,
    schoolId: string,
    studentId: string,
    termId: string,
    academicYearId: string,
  ): Promise<DiscountRuleForSnapshot[]> {
    return db.discountRule.findMany({
      where: {
        schoolId,
        studentId,
        active: true,
        OR: [
          { duration: "LIFETIME" },
          { duration: "TERM", termId },
          { duration: "SESSION", academicYearId },
        ],
      },
      select: {
        id: true,
        name: true,
        feeItemId: true,
        feeCategoryId: true,
        discountType: true,
        value: true,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

function toDto(
  row: {
    id: string;
    schoolId: string;
    studentId: string;
    termId: string;
    academicYearId: string;
    status: string;
    totalAmount: number;
    totalDiscount: number;
    totalDue: number;
    totalPaid: number;
    dueDate: Date | null;
    issuedAt: Date | null;
    issuedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  items: InvoiceLineItemDto[],
): InvoiceDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    status: row.status as InvoiceStatus,
    items,
    totalAmount: row.totalAmount,
    totalDiscount: row.totalDiscount,
    totalDue: row.totalDue,
    totalPaid: row.totalPaid,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
