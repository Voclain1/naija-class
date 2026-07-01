import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type InvoiceStatus,
  type ListPaymentsInput,
  type PaginatedPaymentsDto,
  type PaymentDto,
  type PaymentMethod,
  type PaymentReceiptUrlDto,
  type PaymentStatus,
  type RecordManualPaymentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { StorageService } from "../../common/storage/storage.service.js";

const RECEIPT_URL_TTL_SECONDS = 15 * 60; // 15 minutes

const AUDIT_RECORD = "payment.record";

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

// Derives the correct InvoiceStatus from the authoritative totalPaid and totalDue.
// Called after every successful payment write with a recomputed (not incremented)
// totalPaid so the result is always consistent with the payments table.
// CANCELLED and REFUNDED are terminal — the caller must reject payment before
// reaching this function (it is never called for terminal invoices).
export function computeInvoiceStatus(totalPaid: number, totalDue: number): InvoiceStatus {
  if (totalPaid <= 0) return "ISSUED";
  if (totalPaid < totalDue) return "PARTIALLY_PAID";
  return "PAID";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function receiptNumberFor(paymentId: string): string {
  return `RCP-${paymentId.slice(0, 8).toUpperCase()}`;
}

function formatKoboForMessage(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildReceiptHtml(p: {
  receiptNumber: string;
  paymentId: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference: string | null;
  paidAt: Date;
}): string {
  const naira = (kobo: number) =>
    `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateStr = p.paidAt.toLocaleString("en-NG", { dateStyle: "long", timeStyle: "short" });
  const methodLabel = p.method.replace(/_/g, " ");
  const refRow = p.reference
    ? `<tr><td>Reference</td><td>${escapeHtml(p.reference)}</td></tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Receipt ${escapeHtml(p.receiptNumber)}</title>
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
<h1>Official Receipt</h1>
<p class="sub">${escapeHtml(p.receiptNumber)}</p>
<table>
  <tr><td>Date</td><td>${escapeHtml(dateStr)}</td></tr>
  <tr><td>Invoice</td><td>${escapeHtml(p.invoiceId)}</td></tr>
  <tr><td>Payment method</td><td>${escapeHtml(methodLabel)}</td></tr>
  ${refRow}
  <tr class="total"><td>Amount paid</td><td>${naira(p.amount)}</td></tr>
</table>
<p style="margin-top:32px;font-size:.75rem;color:#888">Payment ID: ${escapeHtml(p.paymentId)}</p>
</body>
</html>`;
}

// Row shape returned by Prisma for the payments table.
type PaymentRow = {
  id: string;
  schoolId: string;
  invoiceId: string;
  studentId: string;
  amount: number;
  method: string;
  status: string;
  paystackReference: string | null;
  reference: string | null;
  receiptNumber: string | null;
  receiptUrl: string | null;
  recordedBy: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    schoolId: row.schoolId,
    invoiceId: row.invoiceId,
    studentId: row.studentId,
    amount: row.amount,
    method: row.method as PaymentMethod,
    status: row.status as PaymentStatus,
    paystackReference: row.paystackReference,
    reference: row.reference,
    receiptNumber: row.receiptNumber,
    receiptUrl: row.receiptUrl,
    recordedBy: row.recordedBy,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PaymentsService {
  constructor(private readonly storage: StorageService) {}

  // ─── Record manual payment ────────────────────────────────────────────────

  async recordManual(
    authCtx: AuthContext,
    dto: RecordManualPaymentInput,
    reqCtx: { ipAddress: string | null; userAgent?: string | null },
  ): Promise<PaymentDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      // 1. Load invoice — RLS ensures school_id matches; double-check to be explicit.
      const invoice = await db.invoice.findUnique({
        where: { id: dto.invoiceId },
        select: { id: true, schoolId: true, studentId: true, status: true, totalDue: true, totalPaid: true },
      });
      if (!invoice || invoice.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Invoice not found.");
      }
      if (invoice.status === "CANCELLED" || invoice.status === "REFUNDED") {
        throw new ConflictError(
          "INVOICE_NOT_PAYABLE",
          `Invoice cannot accept payments in status ${invoice.status}.`,
        );
      }

      // 2. Overpayment guard — REJECT (D1). Remaining = totalDue − totalPaid.
      const remaining = invoice.totalDue - invoice.totalPaid;
      if (dto.amount > remaining) {
        throw new ConflictError(
          "PAYMENT_WOULD_EXCEED_BALANCE",
          `Payment of ${formatKoboForMessage(dto.amount)} would exceed the outstanding balance of ${formatKoboForMessage(remaining)}.`,
        );
      }

      // 3. Create payment row. Status is SUCCESS (D3 — manual = confirmed-in-hand).
      const payment = await db.payment.create({
        data: {
          schoolId: authCtx.schoolId,
          invoiceId: dto.invoiceId,
          studentId: invoice.studentId,
          amount: dto.amount,
          method: dto.method,
          status: "SUCCESS",
          reference: dto.reference ?? null,
          recordedBy: authCtx.userId,
          paidAt: new Date(dto.paidAt),
        },
      });

      // 4. Recompute totalPaid from all SUCCESS rows (D2 — idempotent, self-heals on
      //    the next write if this invoice update below fails).
      const { _sum } = await db.payment.aggregate({
        where: { invoiceId: dto.invoiceId, status: "SUCCESS" },
        _sum: { amount: true },
      });
      const newTotalPaid = _sum.amount ?? 0;
      const newStatus = computeInvoiceStatus(newTotalPaid, invoice.totalDue);

      // 5. Update invoice. Sequential write — no wrapping transaction by design.
      //    A crash between steps 3 and 5 leaves the payment row created but the
      //    invoice totalPaid stale. The recompute in step 4 is idempotent:
      //    the next payment write re-derives the correct total and repairs the
      //    status. Acceptable for pilot-scale concurrency.
      await db.invoice.update({
        where: { id: dto.invoiceId },
        data: { totalPaid: newTotalPaid, status: newStatus },
      });

      // 6. Generate receipt HTML and upload to R2.
      const receiptNumber = receiptNumberFor(payment.id);
      const html = buildReceiptHtml({
        receiptNumber,
        paymentId: payment.id,
        invoiceId: dto.invoiceId,
        amount: dto.amount,
        method: dto.method,
        reference: dto.reference ?? null,
        paidAt: new Date(dto.paidAt),
      });
      const receiptUrl = await this.storage.put(
        authCtx.schoolId,
        { kind: "payment-receipt", paymentId: payment.id },
        Buffer.from(html, "utf8"),
        "text/html",
      );

      // 7. Persist receipt metadata on payment row.
      const updated = await db.payment.update({
        where: { id: payment.id },
        data: { receiptNumber, receiptUrl },
      });

      // 8. Audit log — goes through withTenant so FORCE RLS is satisfied.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_RECORD,
          entityType: "payment",
          entityId: payment.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            invoiceId: dto.invoiceId,
            amount: dto.amount,
            method: dto.method,
            newInvoiceStatus: newStatus,
            newTotalPaid,
          },
        },
      });

      return toDto(updated);
    });
  }

  // ─── List payments ─────────────────────────────────────────────────────────

  async findAll(authCtx: AuthContext, input: ListPaymentsInput): Promise<PaginatedPaymentsDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const where = {
        schoolId: authCtx.schoolId,
        ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
        ...(input.studentId ? { studentId: input.studentId } : {}),
      };
      const [rows, total] = await Promise.all([
        db.payment.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
        }),
        db.payment.count({ where }),
      ]);
      return { data: rows.map(toDto), total, page: input.page, limit: input.limit };
    });
  }

  // ─── Get single payment ───────────────────────────────────────────────────

  async findById(authCtx: AuthContext, id: string): Promise<PaymentDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.payment.findUnique({ where: { id } });
      if (!row || row.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }
      return toDto(row);
    });
  }

  // ─── Signed receipt URL ───────────────────────────────────────────────────

  async getReceiptUrl(authCtx: AuthContext, id: string): Promise<PaymentReceiptUrlDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.payment.findUnique({
        where: { id },
        select: { schoolId: true, receiptUrl: true },
      });
      if (!row || row.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }
      if (!row.receiptUrl) {
        throw new ConflictError("RECEIPT_NOT_READY", "Receipt has not been generated yet.");
      }
      const url = await this.storage.signUrl(
        authCtx.schoolId,
        { kind: "payment-receipt", paymentId: id },
        RECEIPT_URL_TTL_SECONDS,
      );
      return { url, expiresAt: new Date(Date.now() + RECEIPT_URL_TTL_SECONDS * 1000) };
    });
  }
}
