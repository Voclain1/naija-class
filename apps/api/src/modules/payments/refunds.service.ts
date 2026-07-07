import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type CreateRefundInput,
  type RefundDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { PaystackService } from "../../common/paystack/paystack.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { computeInvoiceStatus } from "./payments.service.js";

const AUDIT_REFUND_CREATE = "refund.create";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly paystack: PaystackService,
    private readonly paymentPlan: PaymentPlanService,
  ) {}

  async create(authCtx: AuthContext, dto: CreateRefundInput): Promise<RefundDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      // 1. Load the payment — RLS ensures school_id matches.
      const payment = await db.payment.findUnique({
        where: { id: dto.paymentId },
        select: {
          id: true,
          schoolId: true,
          invoiceId: true,
          amount: true,
          method: true,
          status: true,
          paystackReference: true,
        },
      });
      if (!payment || payment.schoolId !== authCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }
      if (payment.status === "REVERSED") {
        throw new ConflictError("PAYMENT_ALREADY_REVERSED", "This payment has already been reversed.");
      }
      if (payment.status !== "SUCCESS") {
        throw new ConflictError(
          "PAYMENT_NOT_REVERSIBLE",
          `Only confirmed (SUCCESS) payments can be reversed. Current status: ${payment.status}.`,
        );
      }

      // 2. Full-reversal-only guard (D2 — partial refunds deferred).
      if (dto.amount !== payment.amount) {
        throw new ConflictError(
          "PARTIAL_REFUND_NOT_SUPPORTED",
          "Partial refunds are not yet supported. The refund amount must equal the full payment amount.",
        );
      }

      // 3. Load the invoice — verify it is not already terminal.
      const invoice = await db.invoice.findUniqueOrThrow({
        where: { id: payment.invoiceId },
        select: { id: true, totalDue: true, totalPaid: true, status: true, dueDate: true },
      });
      if (invoice.status === "CANCELLED" || invoice.status === "REFUNDED") {
        throw new ConflictError(
          "INVOICE_NOT_REVERSIBLE",
          `Invoice is in terminal status ${invoice.status} and cannot have payments reversed.`,
        );
      }

      // 4. For Paystack payments, call the Paystack refund API before any DB writes.
      //    On API failure: create a FAILED Refund record (audit trail), do NOT
      //    mark the payment REVERSED, do NOT change the invoice.
      let paystackRefundRef: string | null = null;
      if (payment.method === "PAYSTACK") {
        if (!payment.paystackReference) {
          throw new ConflictError(
            "PAYSTACK_REFERENCE_MISSING",
            "Paystack reference is missing on this payment — cannot initiate refund.",
          );
        }
        try {
          const refundData = await this.paystack.refundTransaction(
            payment.paystackReference,
            dto.amount,
          );
          paystackRefundRef = String(refundData.id);
        } catch (err) {
          this.logger.error(`Paystack refund API failed for payment ${payment.id}: ${String(err)}`);
          // Create FAILED refund record as audit trail, then surface the error.
          await db.refund.create({
            data: {
              schoolId: authCtx.schoolId,
              paymentId: payment.id,
              amount: dto.amount,
              reason: dto.reason,
              status: "FAILED",
              paystackRefundRef: null,
              processedBy: authCtx.userId,
            },
          });
          await db.auditLog.create({
            data: {
              schoolId: authCtx.schoolId,
              userId: authCtx.userId,
              action: AUDIT_REFUND_CREATE,
              entityType: "refund",
              entityId: payment.id,
              metadata: {
                paymentId: payment.id,
                amount: dto.amount,
                status: "FAILED",
                error: String(err),
              },
            },
          });
          throw new ConflictError(
            "PAYSTACK_REFUND_FAILED",
            "Paystack refund API rejected the request. No changes were made to the payment or invoice.",
          );
        }
      }

      // 5. Create the Refund record (PROCESSED).
      const refund = await db.refund.create({
        data: {
          schoolId: authCtx.schoolId,
          paymentId: payment.id,
          amount: dto.amount,
          reason: dto.reason,
          status: "PROCESSED",
          paystackRefundRef,
          processedBy: authCtx.userId,
        },
      });

      // 6. Mark the payment as REVERSED.
      await db.payment.update({
        where: { id: payment.id },
        data: { status: "REVERSED" },
      });

      // 7. Recompute totalPaid from all remaining SUCCESS payments.
      const { _sum } = await db.payment.aggregate({
        where: { invoiceId: payment.invoiceId, status: "SUCCESS" },
        _sum: { amount: true },
      });
      const newTotalPaid = _sum.amount ?? 0;

      // 8. Compute new invoice status.
      //    Override: if newTotalPaid === 0, the invoice is REFUNDED (not ISSUED/OVERDUE).
      //    This signals that all payments have been returned, not just "never started paying."
      const computedStatus = computeInvoiceStatus(newTotalPaid, invoice.totalDue, invoice.dueDate);
      const newStatus = newTotalPaid === 0 ? "REFUNDED" : computedStatus;

      // 9. Update the invoice.
      await db.invoice.update({
        where: { id: payment.invoiceId },
        data: { totalPaid: newTotalPaid, status: newStatus },
      });

      // 10. Recompute installment plan paid flags.
      await this.paymentPlan.recomputeInstallmentsPaid(db, payment.invoiceId, newTotalPaid);

      // 11. Audit log.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT_REFUND_CREATE,
          entityType: "refund",
          entityId: refund.id,
          metadata: {
            paymentId: payment.id,
            amount: dto.amount,
            method: payment.method,
            paystackRefundRef,
            newInvoiceStatus: newStatus,
            newTotalPaid,
          },
        },
      });

      return {
        id: refund.id,
        schoolId: refund.schoolId,
        paymentId: refund.paymentId,
        amount: refund.amount,
        reason: refund.reason,
        status: refund.status as "PROCESSED",
        paystackRefundRef: refund.paystackRefundRef,
        processedBy: refund.processedBy,
        createdAt: refund.createdAt,
      };
    });
  }
}
