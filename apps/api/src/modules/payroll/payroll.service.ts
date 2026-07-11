import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreatePayrollItemInput,
  type ListPayrollQuery,
  type PayrollDeduction,
  type PayrollItemDto,
  type PayrollStatus,
  type PayslipUrlDto,
  type UpdatePayrollItemInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { StorageService } from "../../common/storage/storage.service.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT = {
  create: "payroll.create",
  update: "payroll.update",
  approve: "payroll.approve",
  payslipGenerate: "payroll.payslip-generate",
} as const;

const PAYSLIP_URL_TTL_SECONDS = 15 * 60; // mirrors PaymentsService's receipt TTL

const PAYROLL_SELECT = {
  id: true,
  schoolId: true,
  userId: true,
  period: true,
  grossSalary: true,
  deductions: true,
  netSalary: true,
  status: true,
  payslipUrl: true,
  approvedBy: true,
  approvedAt: true,
  paystackTransferCode: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

type PayrollRow = {
  id: string;
  schoolId: string;
  userId: string;
  period: string;
  grossSalary: number;
  deductions: unknown;
  netSalary: number;
  status: string;
  payslipUrl: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  paystackTransferCode: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

// deductions is a JSONB column typed as Prisma.JsonValue. In practice it is
// always PayrollDeduction[] (validated at the Zod boundary on the way in);
// coerce defensively and drop malformed entries, same discipline as
// permissions.guard.ts's coercePermissions.
function coerceDeductions(value: unknown): PayrollDeduction[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is PayrollDeduction =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as PayrollDeduction).name === "string" &&
      typeof (v as PayrollDeduction).amount === "number",
  );
}

function sumDeductions(deductions: PayrollDeduction[]): number {
  return deductions.reduce((total, d) => total + d.amount, 0);
}

function toDto(row: PayrollRow): PayrollItemDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    userId: row.userId,
    period: row.period,
    grossSalary: row.grossSalary,
    deductions: coerceDeductions(row.deductions),
    netSalary: row.netSalary,
    status: row.status as PayrollStatus,
    payslipUrl: row.payslipUrl,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    paystackTransferCode: row.paystackTransferCode,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function naira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildPayslipHtml(p: {
  payrollItemId: string;
  userId: string;
  period: string;
  grossSalary: number;
  deductions: PayrollDeduction[];
  netSalary: number;
  approvedAt: Date;
}): string {
  const deductionRows = p.deductions
    .map((d) => `<tr><td>${escapeHtml(d.name)}</td><td>-${naira(d.amount)}</td></tr>`)
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Payslip ${escapeHtml(p.period)}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; color: #111; }
  h1   { font-size: 1.4rem; margin-bottom: 0; }
  .sub { color: #666; font-size: .875rem; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  td   { padding: 8px 0; border-bottom: 1px solid #eee; }
  td:last-child { text-align: right; }
  .total td { border-top: 2px solid #111; border-bottom: none; font-weight: 700; font-size: 1.1rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Payslip</h1>
<p class="sub">Pay period: ${escapeHtml(p.period)}</p>
<table>
  <tr><td>Gross salary</td><td>${naira(p.grossSalary)}</td></tr>
  ${deductionRows}
  <tr class="total"><td>Net salary</td><td>${naira(p.netSalary)}</td></tr>
</table>
<p style="margin-top:32px;font-size:.75rem;color:#888">
  Approved ${escapeHtml(p.approvedAt.toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" }))}
  &middot; Payroll item: ${escapeHtml(p.payrollItemId)}
</p>
</body>
</html>`;
}

@Injectable()
export class PayrollService {
  constructor(private readonly storage: StorageService) {}

  // userId has no DB-level FK (plain FK convention — see the schema.prisma
  // header comment on PayrollItem), so this pre-check is the ONLY thing
  // standing between a create and a silently dangling user reference.
  private async assertUserExists(db: PrismaClient, schoolId: string, userId: string): Promise<void> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, schoolId: true },
    });
    if (!user || user.schoolId !== schoolId) {
      throw new NotFoundError("Staff member not found.");
    }
  }

  async findAll(authCtx: AuthContext, query: ListPayrollQuery = {}): Promise<PayrollItemDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      const rows = await db.payrollItem.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.period ? { period: query.period } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(query.userId ? { userId: query.userId } : {}),
        },
        select: PAYROLL_SELECT,
        orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      });
      return rows.map(toDto);
    });
  }

  async findById(authCtx: AuthContext, id: string): Promise<PayrollItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.payrollItem.findUnique({ where: { id }, select: PAYROLL_SELECT });
      if (!row) throw new NotFoundError("Payroll item not found.");
      return toDto(row);
    });
  }

  async create(
    authCtx: AuthContext,
    dto: CreatePayrollItemInput,
    reqCtx: RequestContext,
  ): Promise<PayrollItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertUserExists(db, authCtx.schoolId, dto.userId);

      const existing = await db.payrollItem.findUnique({
        where: { schoolId_userId_period: { schoolId: authCtx.schoolId, userId: dto.userId, period: dto.period } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictError(
          "PAYROLL_ITEM_ALREADY_EXISTS",
          `A payroll item already exists for this staff member in ${dto.period}.`,
        );
      }

      const netSalary = dto.grossSalary - sumDeductions(dto.deductions);

      const created = await db.payrollItem.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: dto.userId,
          period: dto.period,
          grossSalary: dto.grossSalary,
          deductions: dto.deductions,
          netSalary,
          createdBy: authCtx.userId,
        },
        select: PAYROLL_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.create,
          entityType: "payroll_item",
          entityId: created.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { userId: created.userId, period: created.period, netSalary },
        },
      });

      return toDto(created);
    });
  }

  // DRAFT only — the status guard is the whole point: an APPROVED item is
  // about to be (or already has been) turned into a payslip/transfer, so its
  // numbers must stop moving. Mirrors GradingService's freeze-after-scores
  // invariant and Invoice's snapshot-on-issue, at the row level instead of
  // the whole-table level.
  async update(
    authCtx: AuthContext,
    id: string,
    dto: UpdatePayrollItemInput,
    reqCtx: RequestContext,
  ): Promise<PayrollItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.payrollItem.findUnique({
        where: { id },
        select: { id: true, status: true, grossSalary: true, deductions: true },
      });
      if (!existing) throw new NotFoundError("Payroll item not found.");
      if (existing.status !== "DRAFT") {
        throw new ConflictError(
          "PAYROLL_NOT_EDITABLE",
          `Only DRAFT payroll items can be edited. Current status: ${existing.status}.`,
        );
      }

      const grossSalary = dto.grossSalary ?? existing.grossSalary;
      const deductions = dto.deductions ?? coerceDeductions(existing.deductions);
      const netSalary = grossSalary - sumDeductions(deductions);

      const updated = await db.payrollItem.update({
        where: { id },
        data: { grossSalary, deductions, netSalary },
        select: PAYROLL_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "payroll_item",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { grossSalary, netSalary },
        },
      });

      return toDto(updated);
    });
  }

  async approve(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<PayrollItemDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.payrollItem.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) throw new NotFoundError("Payroll item not found.");
      if (existing.status !== "DRAFT") {
        throw new ConflictError(
          "PAYROLL_ALREADY_APPROVED",
          `Only DRAFT payroll items can be approved. Current status: ${existing.status}.`,
        );
      }

      const approvedAt = new Date();
      const updated = await db.payrollItem.update({
        where: { id },
        data: { status: "APPROVED", approvedBy: authCtx.userId, approvedAt },
        select: PAYROLL_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.approve,
          entityType: "payroll_item",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: { fromStatus: "DRAFT", toStatus: "APPROVED" },
        },
      });

      return toDto(updated);
    });
  }

  // APPROVED (or later PAID) only — generating a payslip against numbers
  // that can still change (DRAFT) would produce a document that silently
  // stops matching the row, the same failure mode snapshot-on-issue exists
  // to prevent for invoices.
  async generatePayslip(authCtx: AuthContext, id: string, reqCtx: RequestContext): Promise<PayslipUrlDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.payrollItem.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          period: true,
          grossSalary: true,
          deductions: true,
          netSalary: true,
          status: true,
          approvedAt: true,
        },
      });
      if (!existing) throw new NotFoundError("Payroll item not found.");
      if (existing.status === "DRAFT") {
        throw new ConflictError(
          "PAYROLL_NOT_APPROVED",
          "Approve this payroll item before generating a payslip.",
        );
      }

      const html = buildPayslipHtml({
        payrollItemId: existing.id,
        userId: existing.userId,
        period: existing.period,
        grossSalary: existing.grossSalary,
        deductions: coerceDeductions(existing.deductions),
        netSalary: existing.netSalary,
        approvedAt: existing.approvedAt ?? new Date(),
      });

      const payslipUrl = await this.storage.put(
        authCtx.schoolId,
        { kind: "payroll-payslip", payrollItemId: id },
        Buffer.from(html, "utf8"),
        "text/html",
        "inline",
      );

      await db.payrollItem.update({ where: { id }, data: { payslipUrl } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.payslipGenerate,
          entityType: "payroll_item",
          entityId: id,
          ipAddress: reqCtx.ipAddress,
          metadata: {},
        },
      });

      const url = await this.storage.signUrl(
        authCtx.schoolId,
        { kind: "payroll-payslip", payrollItemId: id },
        PAYSLIP_URL_TTL_SECONDS,
      );
      return { url, expiresAt: new Date(Date.now() + PAYSLIP_URL_TTL_SECONDS * 1000) };
    });
  }
}
