import { Injectable, Optional } from "@nestjs/common";

import { Prisma, withTenant, type PrismaClient } from "@school-kit/db";
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
import { PaymentLinkInvalidationService } from "./payment-link-invalidation.service.js";

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
  constructor(
    @Optional() private readonly paymentLinkInvalidation?: PaymentLinkInvalidationService,
  ) {}

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
      const issuerName = await this.resolveIssuerName(db, authCtx.schoolId, authCtx.userId);
      // Resolved ONCE for the whole arm, before the per-student loop — the
      // arm's roster is already in hand, so this stays a single findMany
      // however many invoices the loop goes on to create.
      const studentIdentities = await this.resolveStudentIdentities(
        db,
        authCtx.schoolId,
        enrollments.map((e) => e.studentId),
      );
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
            classArmId: dto.classArmId,
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

        created.push(
          toDto(invoice, snapshot.items, issuerName, studentIdentities.get(studentId) ?? null),
        );
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

      // Same single-batch resolution as generateForArm: the preview table is
      // read by a bursar deciding whether to issue, so it must name students
      // rather than show ids — but not at the cost of a query per row.
      const studentIdentities = await this.resolveStudentIdentities(
        db,
        authCtx.schoolId,
        enrollments.map((e) => e.studentId),
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
        const identity = studentIdentities.get(studentId) ?? null;
        previews.push({
          studentId,
          studentName: identity?.studentName ?? null,
          admissionNumber: identity?.admissionNumber ?? null,
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
      const issuerName = row.issuedBy
        ? await this.resolveIssuerName(db, authCtx.schoolId, row.issuedBy)
        : null;
      const identities = await this.resolveStudentIdentities(db, authCtx.schoolId, [
        row.studentId,
      ]);
      return toDto(
        row,
        row.items as unknown as InvoiceLineItemDto[],
        issuerName,
        identities.get(row.studentId) ?? null,
      );
    });
  }

  async findAll(authCtx: AuthContext, query: ListInvoicesInput): Promise<PaginatedInvoicesDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const where: Prisma.InvoiceWhereInput = {
        schoolId: authCtx.schoolId,
        ...(query.classArmId ? { classArmId: query.classArmId } : {}),
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

      const [issuerNames, studentIdentities] = await Promise.all([
        this.resolveIssuerNames(
          db,
          authCtx.schoolId,
          rows.flatMap((row) => (row.issuedBy ? [row.issuedBy] : [])),
        ),
        this.resolveStudentIdentities(
          db,
          authCtx.schoolId,
          rows.map((row) => row.studentId),
        ),
      ]);

      return {
        data: rows.map((r) =>
          toDto(
            r,
            r.items as unknown as InvoiceLineItemDto[],
            r.issuedBy ? (issuerNames.get(r.issuedBy) ?? null) : null,
            studentIdentities.get(r.studentId) ?? null,
          ),
        ),
        total,
        page: query.page,
        limit: query.limit,
      };
    });
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  async cancel(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<InvoiceDto> {
    const result = await withTenant(authCtx.schoolId, async (db) => {
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
      await this.paymentLinkInvalidation?.markForArchive(db, authCtx.schoolId, id);

      const issuerName = updated.issuedBy
        ? await this.resolveIssuerName(db, authCtx.schoolId, updated.issuedBy)
        : null;
      const identities = await this.resolveStudentIdentities(db, authCtx.schoolId, [
        updated.studentId,
      ]);
      return toDto(
        updated,
        updated.items as unknown as InvoiceLineItemDto[],
        issuerName,
        identities.get(updated.studentId) ?? null,
      );
    });
    await this.paymentLinkInvalidation?.archivePending(authCtx.schoolId, id);
    return result;
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

  private async resolveIssuerName(
    db: PrismaClient,
    schoolId: string,
    userId: string,
  ): Promise<string | null> {
    const names = await this.resolveIssuerNames(db, schoolId, [userId]);
    return names.get(userId) ?? null;
  }

  // Batched student identity for the list/detail surfaces. Mirrors
  // resolveIssuerNames exactly: ONE findMany over the de-duplicated id set,
  // never a per-row lookup, so a 200-invoice page costs two queries rather
  // than 201. Both fields are tenant-scoped by the `schoolId` filter on top
  // of RLS — a student id from another school resolves to nothing rather
  // than leaking a name.
  private async resolveStudentIdentities(
    db: PrismaClient,
    schoolId: string,
    studentIds: string[],
  ): Promise<Map<string, StudentIdentity>> {
    const uniqueIds = [...new Set(studentIds)];
    if (uniqueIds.length === 0) return new Map();

    const students = await db.student.findMany({
      where: { schoolId, id: { in: uniqueIds } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
    });
    return new Map(
      students.map((student) => [
        student.id,
        {
          studentName: `${student.firstName} ${student.lastName}`.trim() || null,
          admissionNumber: student.admissionNumber,
        },
      ]),
    );
  }

  private async resolveIssuerNames(
    db: PrismaClient,
    schoolId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();

    const users = await db.user.findMany({
      where: { schoolId, id: { in: uniqueIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(
      users.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]),
    );
  }
}

// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------

interface StudentIdentity {
  studentName: string | null;
  admissionNumber: string | null;
}

function toDto(
  row: {
    id: string;
    schoolId: string;
    studentId: string;
    termId: string;
    academicYearId: string;
    classArmId: string | null;
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
  issuedByName: string | null,
  studentIdentity: StudentIdentity | null,
): InvoiceDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    studentId: row.studentId,
    studentName: studentIdentity?.studentName ?? null,
    admissionNumber: studentIdentity?.admissionNumber ?? null,
    termId: row.termId,
    academicYearId: row.academicYearId,
    classArmId: row.classArmId,
    status: row.status as InvoiceStatus,
    items,
    totalAmount: row.totalAmount,
    totalDiscount: row.totalDiscount,
    totalDue: row.totalDue,
    totalPaid: row.totalPaid,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    issuedAt: row.issuedAt,
    issuedBy: row.issuedBy,
    issuedByName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
