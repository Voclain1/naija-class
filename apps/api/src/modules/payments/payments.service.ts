import { Injectable, Logger, Optional } from "@nestjs/common";

import { Prisma, type PrismaClient, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type InitPaystackPaymentInput,
  type InvoiceStatus,
  type ListPaymentsInput,
  type ListReceiptsInput,
  type ReceiptListResponse,
  type ReissueReceiptResultDto,
  type ManualPaymentResultDto,
  type PaginatedPaymentsDto,
  type PaymentDto,
  type PaymentMethod,
  type PaymentReceiptUrlDto,
  type PaymentStatus,
  type PaystackInitResponseDto,
  type PaystackWebhookEvent,
  type RecordManualPaymentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { PaystackService } from "../../common/paystack/paystack.service.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { PaymentLinkInvalidationService } from "../invoices/payment-link-invalidation.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { issueReceipt } from "./receipt.js";

const RECEIPT_URL_TTL_SECONDS = 15 * 60; // 15 minutes

const AUDIT_RECORD = "payment.record";
const AUDIT_RECEIPT_REISSUE = "payment.receipt-reissue";

// Branded receipts: opening, listing and re-issuing check the owner/admin/
// bursar ROLE on top of payment.read / payment.record, so a custom role ever
// granted payment.read still cannot issue receipts. Written as literal arrays
// at each call: rbac-two-gate-conformance.spec.ts reads them from source.
const AUDIT_PAYSTACK_CONFIRM = "payment.paystack-confirm";
const AUDIT_PAYSTACK_FAILED = "payment.paystack-failed";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

// Derives the correct InvoiceStatus from totalPaid, totalDue, and an optional
// dueDate. CANCELLED and REFUNDED are terminal — the caller must reject payment
// before reaching this function (it is never called for terminal invoices).
//
// dueDate is optional (absent for payment-recording callers that never go DOWN
// the status ladder). Pass dueDate when the status may need to stay OVERDUE
// after a reversal, i.e. when totalPaid could drop below totalDue.
export function computeInvoiceStatus(
  totalPaid: number,
  totalDue: number,
  dueDate?: Date | null,
): InvoiceStatus {
  if (totalPaid >= totalDue) return "PAID";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = !!dueDate && dueDate < today;
  if (totalPaid <= 0) return isOverdue ? "OVERDUE" : "ISSUED";
  return isOverdue ? "OVERDUE" : "PARTIALLY_PAID";
}

// Parses a Paystack reference of the form "PSK-{schoolId}-{paymentId}" (77 chars).
// Returns null for any string that does not match the exact structure.
// Exported so the spec can test it directly.
export function parsePaystackReference(
  ref: string,
): { schoolId: string; paymentId: string } | null {
  if (!ref.startsWith("PSK-")) return null;
  const rest = ref.slice(4); // "{schoolId}-{paymentId}", 73 chars
  if (rest.length !== 73) return null;
  const schoolId = rest.slice(0, 36);
  const paymentId = rest.slice(37); // skip separator "-"
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(schoolId) || !uuidRe.test(paymentId)) return null;
  return { schoolId, paymentId };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatKoboForMessage(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
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
  paystackData: unknown;
  reference: string | null;
  receiptNumber: string | null;
  receiptUrl: string | null;
  recordedBy: string | null;
  paidAt: Date | null;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// A unique violation. Under FORCE RLS the P2002 target is not reported, so
// this cannot say WHICH constraint fired; recordManual only consults it when
// the request carried an idempotency key, and then re-reads by that key — the
// re-read, not this check, is what decides a replay.
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// Minimal payment shape needed by the Paystack apply helpers.
type PaymentCore = {
  id: string;
  schoolId: string;
  invoiceId: string;
  studentId: string;
  amount: number;
  method: string;
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
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly paystack: PaystackService,
    private readonly paymentPlan: PaymentPlanService,
    @Optional() private readonly paymentLinkInvalidation?: PaymentLinkInvalidationService,
  ) {}

  // ─── Record manual payment ────────────────────────────────────────────────

  // D37 — idempotent by client key. A request whose key this school has
  // already used returns the ORIGINAL payment (replayed: true) and writes
  // nothing: no second payment, no second audit row, no second recompute.
  // Two guards, deliberately:
  //   - the lookup below answers the ordinary retry cheaply;
  //   - the (school_id, idempotency_key) unique index answers the race, where
  //     two requests pass the lookup together. The loser's INSERT fails, its
  //     transaction rolls back whole, and it re-reads the winner's row.
  // A key reused for a DIFFERENT payment is a 409, never a silent success —
  // replaying the wrong payment would tell the bursar cash was recorded when
  // it was not.
  async recordManual(
    authCtx: AuthContext,
    dto: RecordManualPaymentInput,
    reqCtx: { ipAddress: string | null; userAgent?: string | null },
  ): Promise<ManualPaymentResultDto> {
    if (dto.idempotencyKey) {
      const prior = await this.findByIdempotencyKey(authCtx.schoolId, dto.idempotencyKey);
      if (prior) return this.replay(prior, dto);
    }

    let result: PaymentDto;
    try {
      result = await this.recordManualOnce(authCtx, dto, reqCtx);
    } catch (e) {
      if (dto.idempotencyKey && isUniqueViolation(e)) {
        const prior = await this.findByIdempotencyKey(authCtx.schoolId, dto.idempotencyKey);
        if (prior) return this.replay(prior, dto);
      }
      throw e;
    }
    await this.paymentLinkInvalidation?.archivePending(authCtx.schoolId, dto.invoiceId);
    return { ...result, replayed: false };
  }

  private findByIdempotencyKey(schoolId: string, key: string): Promise<PaymentRow | null> {
    return withTenant(schoolId, (db) =>
      db.payment.findUnique({
        where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: key } },
      }) as Promise<PaymentRow | null>,
    );
  }

  private replay(prior: PaymentRow, dto: RecordManualPaymentInput): ManualPaymentResultDto {
    const same =
      prior.invoiceId === dto.invoiceId &&
      prior.amount === dto.amount &&
      prior.method === dto.method &&
      (prior.reference ?? null) === (dto.reference ?? null) &&
      prior.paidAt !== null &&
      prior.paidAt.getTime() === new Date(dto.paidAt).getTime();
    if (!same) {
      throw new ConflictError(
        "IDEMPOTENCY_KEY_REUSED",
        "This payment form was already used to record a different payment. Start a new payment.",
      );
    }
    this.logger.log(`Manual payment replayed for key on payment ${prior.id}; nothing new recorded.`);
    return { ...toDto(prior), replayed: true };
  }

  private async recordManualOnce(
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
          idempotencyKey: dto.idempotencyKey ?? null,
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

      // 6. Issue the branded receipt (docs/modules/branded-receipts.md): the
      //    next sequential number is drawn INSIDE this transaction, so a
      //    payment that rolls back returns its number. Issued after the
      //    totals above so the receipt's balance is the balance after this
      //    payment.
      const { receiptNumber, receiptUrl } = await issueReceipt(db, this.storage, {
        schoolId: authCtx.schoolId,
        paymentId: payment.id,
        totalPaidAfter: newTotalPaid,
      });

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

      // 9. Update installment paid flags if an installment plan exists.
      await this.paymentPlan.recomputeInstallmentsPaid(db, dto.invoiceId, newTotalPaid);
      await this.paymentLinkInvalidation?.markForArchive(
        db,
        authCtx.schoolId,
        dto.invoiceId,
      );

      return toDto(updated as PaymentRow);
    });
  }

  // ─── Initiate Paystack payment ─────────────────────────────────────────────

  async initPaystack(
    authCtx: AuthContext,
    dto: InitPaystackPaymentInput,
  ): Promise<PaystackInitResponseDto> {
    // Phase 1: validate and create PENDING payment row (short DB transaction).
    const { paymentId, customerEmail, subaccountCode } = await withTenant(authCtx.schoolId, async (db) => {
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

      // Paystack subaccount routing (compressed plan-first, 2026-07-31) —
      // server-side gate, not just a hidden UI button. A manual-only school
      // (the default for every school) must reject this at the API layer;
      // checked before creating the PENDING payment row so a disabled school
      // doesn't accumulate doomed rows.
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { paystackPaymentsEnabled: true, paystackSubaccountCode: true },
      });
      if (!school?.paystackPaymentsEnabled || !school.paystackSubaccountCode) {
        throw new ConflictError(
          "PAYSTACK_NOT_ENABLED",
          "Paystack payments are not enabled for this school. Use a manual payment method (cash, POS, or bank transfer) instead.",
        );
      }

      const remaining = invoice.totalDue - invoice.totalPaid;
      if (dto.amount > remaining) {
        throw new ConflictError(
          "PAYMENT_WOULD_EXCEED_BALANCE",
          `Payment of ${formatKoboForMessage(dto.amount)} would exceed the outstanding balance of ${formatKoboForMessage(remaining)}.`,
        );
      }

      // Resolve customer email: primary guardian's email or synthetic fallback.
      // We do NOT send any student PII to Paystack — just a routing email.
      const guardianLink = await db.studentGuardian.findFirst({
        where: { studentId: invoice.studentId, isPrimary: true },
        select: { guardian: { select: { email: true } } },
      });

      const payment = await db.payment.create({
        data: {
          schoolId: authCtx.schoolId,
          invoiceId: dto.invoiceId,
          studentId: invoice.studentId,
          amount: dto.amount,
          method: "PAYSTACK",
          status: "PENDING",
          recordedBy: authCtx.userId,
        },
        select: { id: true },
      });

      // Synthetic email uses payment.id so it is stable across retries.
      const resolvedEmail =
        guardianLink?.guardian?.email ?? `noreply-${payment.id.slice(0, 8)}@schoolkit.ng`;

      return {
        paymentId: payment.id,
        customerEmail: resolvedEmail,
        subaccountCode: school.paystackSubaccountCode,
      };
    });

    // Phase 2: call Paystack API (outside DB transaction — avoids holding a
    // connection open during a network call).
    const paystackReference = `PSK-${authCtx.schoolId}-${paymentId}`;
    let initData: { authorization_url: string };
    try {
      initData = await this.paystack.initializeTransaction({
        amount: dto.amount,
        email: customerEmail,
        reference: paystackReference,
        subaccount: subaccountCode,
      });
    } catch (err) {
      // Paystack API failed — mark the PENDING row as FAILED so it does not linger.
      await withTenant(authCtx.schoolId, (db) =>
        db.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } }),
      );
      throw err;
    }

    // Phase 3: persist the Paystack reference onto the payment row.
    await withTenant(authCtx.schoolId, (db) =>
      db.payment.update({ where: { id: paymentId }, data: { paystackReference } }),
    );

    return {
      authorizationUrl: initData.authorization_url,
      reference: paystackReference,
      paymentId,
    };
  }

  // ─── Handle Paystack webhook ───────────────────────────────────────────────

  async handleWebhook(event: PaystackWebhookEvent): Promise<void> {
    const { event: eventType, data } = event;

    if (eventType !== "charge.success" && eventType !== "charge.failed") {
      return; // silently ignore events we don't handle
    }

    const parsed = parsePaystackReference(data.reference);
    if (!parsed) {
      this.logger.warn(`Webhook: unrecognized reference format: ${data.reference}`);
      return;
    }
    const { schoolId, paymentId } = parsed;

    let balanceChanged = false;
    await withTenant(schoolId, async (db) => {
      const payment = await db.payment.findUnique({
        where: { id: paymentId },
        select: {
          id: true,
          schoolId: true,
          invoiceId: true,
          studentId: true,
          amount: true,
          method: true,
          status: true,
        },
      });

      if (!payment || payment.schoolId !== schoolId) {
        this.logger.warn(`Webhook: payment ${paymentId} not found for school ${schoolId}`);
        return;
      }

      // Idempotency: terminal rows are never re-processed.
      if (
        payment.status === "SUCCESS" ||
        payment.status === "FAILED" ||
        payment.status === "REVERSED"
      ) {
        this.logger.log(
          `Webhook: payment ${paymentId} already terminal (${payment.status}), skipping`,
        );
        return;
      }

      if (eventType === "charge.success") {
        const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
        await this.applyPaystackSuccess(db, payment, data as Record<string, unknown>, paidAt);
        await this.paymentLinkInvalidation?.markForArchive(db, schoolId, payment.invoiceId);
        balanceChanged = true;
      } else {
        await this.applyPaystackFailed(db, payment);
      }
    });
    if (balanceChanged) {
      await this.paymentLinkInvalidation?.archivePending(schoolId);
    }
  }

  async handlePaymentRequestWebhook(event: PaystackWebhookEvent): Promise<void> {
    if (event.event !== "paymentrequest.success") return;
    const metadata = asRecord(event.data.metadata);
    const schoolId = asUuid(metadata?.schoolId);
    const linkId = asUuid(metadata?.schoolKitPaymentLinkId);
    const invoiceId = asUuid(metadata?.invoiceId);
    if (!schoolId || !linkId || !invoiceId) {
      this.logger.error("Payment Request webhook rejected: invalid correlation metadata");
      return;
    }

    const link = await withTenant(schoolId, (db) =>
      db.paymentLink.findUnique({ where: { id: linkId } }),
    );
    if (
      !link ||
      link.schoolId !== schoolId ||
      link.invoiceId !== invoiceId ||
      !link.requestCode ||
      !link.requestId ||
      !link.paystackCustomerCode ||
      !["LIVE", "PAID"].includes(link.status)
    ) {
      this.logger.error("Payment Request webhook rejected: stored link correlation failed");
      return;
    }
    if (link.status === "PAID") return;

    const request = await this.paystack.getPaymentRequest(link.requestCode);
    const requestMetadata = request.metadata;
    if (
      BigInt(request.id) !== link.requestId ||
      request.request_code !== link.requestCode ||
      request.amount !== link.amount ||
      request.currency !== link.currency ||
      request.status !== "success" ||
      request.split_code === null ||
      request.customer.customer_code !== link.paystackCustomerCode ||
      requestMetadata?.schoolId !== schoolId ||
      requestMetadata?.invoiceId !== invoiceId ||
      requestMetadata?.schoolKitPaymentLinkId !== linkId
    ) {
      this.logger.error("Payment Request webhook rejected: Paystack request verification mismatch");
      return;
    }

    const embedded = request.transactions?.find((transaction) => transaction.status === "success");
    const eventTransaction = asRecord(event.data.transaction);
    const reference =
      (typeof eventTransaction?.reference === "string" ? eventTransaction.reference : undefined) ??
      embedded?.reference;
    if (!reference) {
      this.logger.error("Payment Request webhook rejected: successful transaction missing");
      return;
    }
    const transaction = await this.paystack.verifyTransaction(reference);
    if (
      transaction.status !== "success" ||
      transaction.reference !== reference ||
      transaction.amount !== link.amount ||
      transaction.currency !== link.currency ||
      transaction.split?.split_code !== request.split_code
    ) {
      this.logger.error("Payment Request webhook rejected: transaction verification mismatch");
      return;
    }

    const paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();
    const applied = await withTenant(schoolId, async (db) => {
      const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.schoolId !== schoolId) return false;
      const claim = await db.paymentLink.updateMany({
        where: { id: linkId, schoolId, invoiceId, status: "LIVE" },
        data: { status: "PAID", paidAt, hostedUrl: null, failureCode: null },
      });
      if (claim.count === 0) return false;

      const payment = await db.payment.create({
          data: {
            schoolId,
            invoiceId,
            studentId: invoice.studentId,
            amount: link.amount,
            method: "PAYSTACK",
            status: "SUCCESS",
            paystackReference: reference,
            paystackData: transaction as object,
            recordedBy: link.createdBy,
            paidAt,
          },
      });
      const aggregate = await db.payment.aggregate({
          where: { invoiceId, status: "SUCCESS" },
          _sum: { amount: true },
      });
      const newTotalPaid = aggregate._sum.amount ?? 0;
      const newStatus = computeInvoiceStatus(newTotalPaid, invoice.totalDue);
      await db.invoice.update({
          where: { id: invoiceId },
          data: { totalPaid: newTotalPaid, status: newStatus },
      });
      await this.paymentLinkInvalidation?.markForArchive(db, schoolId, invoiceId, linkId);
      await db.auditLog.createMany({
          data: [
            {
              schoolId,
              userId: null,
              action: AUDIT_PAYSTACK_CONFIRM,
              entityType: "payment",
              entityId: payment.id,
              metadata: { invoiceId, amount: link.amount, newInvoiceStatus: newStatus, newTotalPaid },
            },
            {
              schoolId,
              userId: null,
              action: "payment-link.paid",
              entityType: "payment_link",
              entityId: linkId,
              metadata: { invoiceId, paymentId: payment.id, reference },
            },
          ],
      });
      await this.paymentPlan.recomputeInstallmentsPaid(db, invoiceId, newTotalPaid);
      return true;
    });
    if (applied) await this.paymentLinkInvalidation?.archivePending(schoolId, invoiceId);
  }

  // ─── Verify Paystack payment (self-heal) ───────────────────────────────────

  // Public — Phase 4 / Slice 5. "Check Paystack, apply the result if not
  // already applied," shared by BOTH the staff-facing verifyPaystack
  // (below, a thin wrapper) and PortalPaymentsService.verify. Deliberately
  // takes a plain schoolId, not an AuthContext — the guardian caller has a
  // GuardianAuthContext instead, and the cross-tenant check here (does this
  // reference actually belong to the caller's school) applies identically
  // to both; guardian-specific authorization (does THIS guardian own the
  // specific student this payment belongs to) is the caller's job, checked
  // BEFORE this method is ever called — this method has no concept of a
  // guardian at all.
  //
  // Safe to call repeatedly and concurrently for the same reference — two
  // layers, not one:
  //   1. A terminal-status short-circuit BEFORE calling Paystack at all
  //      (new in this refactor — the original single-caller version only
  //      checked terminal status AFTER the Paystack call, which was fine
  //      when this was called once per staff checkout, but wasteful now
  //      that a guardian's browser polls this up to ~8 times per payment
  //      attempt) and again after, in case status flipped in between (e.g.
  //      the webhook landed while the Paystack call was in flight).
  //   2. applyPaystackSuccess/applyPaystackFailed's own atomic
  //      updateMany({ where: { status: "PENDING" } }) guard (see those
  //      methods) — THIS is what actually closes the race window, for the
  //      case where two concurrent calls (e.g. a guardian poll and the
  //      webhook) both pass the terminal-status check above before either
  //      commits. Without it, both would re-run the receipt-generation/
  //      recompute/audit-log sequence — harmless to totalPaid (the
  //      recompute-from-rows aggregate is correct either way) but would
  //      write a duplicate audit_log row. See this slice's own concurrency
  //      test for what's actually proven, not just asserted here.
  async verifyAndApply(schoolId: string, reference: string): Promise<PaymentDto> {
    const parsed = parsePaystackReference(reference);
    if (!parsed || parsed.schoolId !== schoolId) {
      throw new NotFoundError("Payment not found.");
    }

    const existing = await withTenant(schoolId, (db) =>
      db.payment.findUnique({ where: { id: parsed.paymentId } }),
    );
    if (!existing || existing.schoolId !== schoolId) {
      throw new NotFoundError("Payment not found.");
    }
    if (existing.status === "SUCCESS" || existing.status === "FAILED" || existing.status === "REVERSED") {
      return toDto(existing as PaymentRow);
    }

    // Call Paystack verify outside a DB transaction (avoids holding connection during network I/O).
    const verifyData = await this.paystack.verifyTransaction(reference);

    return withTenant(schoolId, async (db) => {
      const payment = await db.payment.findUnique({
        where: { id: parsed.paymentId },
        select: {
          id: true,
          schoolId: true,
          invoiceId: true,
          studentId: true,
          amount: true,
          method: true,
          status: true,
        },
      });

      if (!payment || payment.schoolId !== schoolId) {
        throw new NotFoundError("Payment not found.");
      }

      // Re-check: status may have flipped between the fast-path read above
      // and now (e.g. the webhook landed while verifyTransaction was in
      // flight).
      if (
        payment.status === "SUCCESS" ||
        payment.status === "FAILED" ||
        payment.status === "REVERSED"
      ) {
        const row = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
        return toDto(row as PaymentRow);
      }

      if (verifyData.status === "success") {
        const paidAt = verifyData.paid_at ? new Date(verifyData.paid_at) : new Date();
        await this.applyPaystackSuccess(
          db,
          payment,
          { reference, status: verifyData.status, amount: verifyData.amount, paid_at: verifyData.paid_at },
          paidAt,
        );
      } else {
        await this.applyPaystackFailed(db, payment);
      }

      const row = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      return toDto(row as PaymentRow);
    });
  }

  async verifyPaystack(authCtx: AuthContext, reference: string): Promise<PaymentDto> {
    return this.verifyAndApply(authCtx.schoolId, reference);
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
      return { data: rows.map((r) => toDto(r as PaymentRow)), total, page: input.page, limit: input.limit };
    });
  }

  // ─── Get single payment ───────────────────────────────────────────────────

  async findById(authCtx: AuthContext, id: string): Promise<PaymentDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.payment.findUnique({ where: { id } });
      if (!row || row.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }
      return toDto(row as PaymentRow);
    });
  }

  // ─── Signed receipt URL ───────────────────────────────────────────────────

  async getReceiptUrl(authCtx: AuthContext, id: string): Promise<PaymentReceiptUrlDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "bursar"]);
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

  // ─── Branded receipts: list and re-issue ─────────────────────────────────

  // GET /payments/receipts — issued receipts, newest first. Search matches the
  // student's first/last name or admission number. One query for the page
  // plus one for the students on it.
  async listReceipts(authCtx: AuthContext, query: ListReceiptsInput): Promise<ReceiptListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "bursar"]);
    return withTenant(authCtx.schoolId, async (db) => {
      let studentFilter: { studentId: { in: string[] } } | Record<string, never> = {};
      if (query.search) {
        const matches = await db.student.findMany({
          where: {
            OR: [
              { firstName: { contains: query.search, mode: "insensitive" } },
              { lastName: { contains: query.search, mode: "insensitive" } },
              { admissionNumber: { contains: query.search, mode: "insensitive" } },
            ],
          },
          select: { id: true },
          take: 200,
        });
        studentFilter = { studentId: { in: matches.map((m) => m.id) } };
      }
      const rows = await db.payment.findMany({
        where: { status: "SUCCESS", receiptNumber: { not: null }, ...studentFilter },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit + 1,
        select: { id: true, receiptNumber: true, amount: true, method: true, paidAt: true, studentId: true },
      });
      const page = rows.slice(0, query.limit);
      const students = await db.student.findMany({
        where: { id: { in: [...new Set(page.map((r) => r.studentId))] } },
        select: { id: true, firstName: true, lastName: true, admissionNumber: true },
      });
      const byId = new Map(students.map((st) => [st.id, st]));
      return {
        page: query.page,
        hasMore: rows.length > query.limit,
        data: page.map((r) => {
          const st = byId.get(r.studentId);
          return {
            paymentId: r.id,
            receiptNumber: r.receiptNumber as string,
            amount: r.amount,
            method: r.method as PaymentMethod,
            paidAt: r.paidAt,
            studentName: st ? `${st.firstName} ${st.lastName}` : "Unknown student",
            admissionNumber: st?.admissionNumber ?? "",
          };
        }),
      };
    });
  }

  // POST /payments/:id/receipt/reissue (D4). Regenerates the receipt in the
  // current design and branding, KEEPING its number and date — the facts on a
  // receipt never change, only how it looks. "Balance after" is recomputed as
  // it stood at this payment: every successful payment on the invoice recorded
  // up to and including this one. Audited, every time.
  async reissueReceipt(
    authCtx: AuthContext,
    id: string,
    reqCtx: { ipAddress: string | null },
  ): Promise<ReissueReceiptResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "bursar"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const payment = await db.payment.findUnique({
        where: { id },
        select: { id: true, schoolId: true, invoiceId: true, status: true, receiptNumber: true, createdAt: true },
      });
      if (!payment || payment.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }
      if (payment.status !== "SUCCESS") {
        throw new ConflictError("RECEIPT_NOT_AVAILABLE", "Only a successful payment has a receipt.");
      }
      const { _sum } = await db.payment.aggregate({
        where: { invoiceId: payment.invoiceId, status: "SUCCESS", createdAt: { lte: payment.createdAt } },
        _sum: { amount: true },
      });
      const { receiptNumber, receiptUrl } = await issueReceipt(db, this.storage, {
        schoolId: authCtx.schoolId,
        paymentId: payment.id,
        totalPaidAfter: _sum.amount ?? 0,
        ...(payment.receiptNumber ? { receiptNumber: payment.receiptNumber } : {}),
      });
      await db.payment.update({ where: { id: payment.id }, data: { receiptNumber, receiptUrl } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_RECEIPT_REISSUE,
          entityType: "payment",
          entityId: payment.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { receiptNumber, keptNumber: payment.receiptNumber !== null },
        },
      });
      return { paymentId: payment.id, receiptNumber };
    });
  }

  // ─── Private: apply Paystack success ──────────────────────────────────────

  private async applyPaystackSuccess(
    db: PrismaClient,
    payment: PaymentCore,
    paystackData: Record<string, unknown>,
    paidAt: Date,
  ): Promise<void> {
    // 1. Transition payment to SUCCESS and store Paystack payload — an
    // ATOMIC conditional update (updateMany + a status: "PENDING" filter),
    // not a plain update. This is what actually closes the race window
    // callers' own terminal-status checks can't: two concurrent calls
    // (verifyAndApply from a guardian poll, and the webhook, or two
    // overlapping polls) can both pass their own "is this already
    // terminal?" read before either commits. Only one of two concurrent
    // updateMany calls with this WHERE clause can affect the row; the
    // loser gets count: 0 and bails out here, before any of steps 2-7
    // (receipt generation, recompute, audit log) run a second time. Added
    // specifically for Slice 5's guardian-facing verifyAndApply, which
    // introduced the first caller that can genuinely race the webhook —
    // the original single staff-triggered call site never needed this.
    const claim = await db.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: {
        status: "SUCCESS",
        paidAt,
        paystackData: paystackData as object,
      },
    });
    if (claim.count === 0) {
      this.logger.log(`Payment ${payment.id} already claimed by a concurrent apply — skipping`);
      return;
    }

    // 2. Recompute totalPaid aggregate (idempotent — includes this payment now it's SUCCESS).
    const { _sum } = await db.payment.aggregate({
      where: { invoiceId: payment.invoiceId, status: "SUCCESS" },
      _sum: { amount: true },
    });
    const newTotalPaid = _sum.amount ?? 0;

    // 3. Issue the branded receipt, after the totals so it shows the balance
    //    after this payment. "Received by" reads "Paid online (Paystack)"
    //    because an online payment has no recorder.
    const { receiptNumber, receiptUrl } = await issueReceipt(db, this.storage, {
      schoolId: payment.schoolId,
      paymentId: payment.id,
      totalPaidAfter: newTotalPaid,
    });

    const invoice = await db.invoice.findUniqueOrThrow({
      where: { id: payment.invoiceId },
      select: { totalDue: true },
    });
    const newStatus = computeInvoiceStatus(newTotalPaid, invoice.totalDue);

    // 4. Persist receipt metadata.
    await db.payment.update({
      where: { id: payment.id },
      data: { receiptNumber, receiptUrl },
    });

    // 5. Update invoice.
    await db.invoice.update({
      where: { id: payment.invoiceId },
      data: { totalPaid: newTotalPaid, status: newStatus },
    });

    // 6. Audit log (userId null — webhook has no authenticated user).
    await db.auditLog.create({
      data: {
        schoolId: payment.schoolId,
        userId: null,
        action: AUDIT_PAYSTACK_CONFIRM,
        entityType: "payment",
        entityId: payment.id,
        metadata: {
          invoiceId: payment.invoiceId,
          amount: payment.amount,
          newInvoiceStatus: newStatus,
          newTotalPaid,
        },
      },
    });

    // 7. Update installment paid flags if an installment plan exists.
    await this.paymentPlan.recomputeInstallmentsPaid(db, payment.invoiceId, newTotalPaid);
  }

  // ─── Private: apply Paystack failed ───────────────────────────────────────

  private async applyPaystackFailed(db: PrismaClient, payment: PaymentCore): Promise<void> {
    // Same atomic-claim reasoning as applyPaystackSuccess above.
    const claim = await db.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: { status: "FAILED" },
    });
    if (claim.count === 0) {
      this.logger.log(`Payment ${payment.id} already claimed by a concurrent apply — skipping`);
      return;
    }

    await db.auditLog.create({
      data: {
        schoolId: payment.schoolId,
        userId: null,
        action: AUDIT_PAYSTACK_FAILED,
        entityType: "payment",
        entityId: payment.id,
        metadata: { invoiceId: payment.invoiceId, amount: payment.amount },
      },
    });
  }
}
