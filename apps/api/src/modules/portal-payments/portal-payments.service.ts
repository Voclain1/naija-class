import { Injectable, Logger } from "@nestjs/common";

import { withGuardian, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  type PaymentDto,
  type PaystackInitResponseDto,
  type PortalPaymentDto,
} from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import { PaystackService } from "../../common/paystack/paystack.service.js";
import { parsePaystackReference, PaymentsService } from "../payments/payments.service.js";

interface RequestContext {
  ipAddress: string | null;
}

const AUDIT_INIT = "payment.guardian-init";

// A checkout page Paystack considers "live" is time-bounded on their end
// too — this window is deliberately generous relative to that, not an
// attempt to match it exactly. Without SOME bound, a guardian who starts a
// checkout and abandons it (closes the tab, changes their mind) would
// permanently block every future payment attempt on that invoice, since
// nothing ever transitions an abandoned PENDING row to FAILED — Paystack
// only sends charge.failed for an attempted-and-declined payment, not for
// a checkout that was simply never completed. Found while implementing the
// in-flight-payment guard itself, not in the original plan-first.
const IN_FLIGHT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

// Where the guardian's browser lands after completing (or abandoning)
// Paystack checkout. Mirrors GuardiansService's own portalBaseUrl() helper
// exactly — not shared as an import between the two, same "genuinely
// independent constants that happen to agree" reasoning that file's own
// comment gives for the analogous TTL constant.
function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? "http://localhost:3002";
}

// PaymentDto is a structural superset of PortalPaymentDto (schoolId,
// recordedBy, paystackReference, reference, receiptNumber/receiptUrl
// dropped — see PortalPaymentDto's own header comment for why). Same
// enum types (PaymentMethod/PaymentStatus) on both sides, so no casts
// needed, just field selection.
function toPortalPaymentDto(dto: PaymentDto): PortalPaymentDto {
  return {
    id: dto.id,
    invoiceId: dto.invoiceId,
    studentId: dto.studentId,
    amount: dto.amount,
    method: dto.method,
    status: dto.status,
    paidAt: dto.paidAt,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

@Injectable()
export class PortalPaymentsService {
  private readonly logger = new Logger(PortalPaymentsService.name);

  constructor(
    private readonly paystack: PaystackService,
    private readonly paymentsService: PaymentsService,
  ) {}

  // POST /portal/students/:id/invoices/:invoiceId/pay
  //
  // No amount in the request — the server always charges the exact
  // outstanding balance (totalDue - totalPaid), computed here, never
  // accepted from the client. Deliberately narrower than the staff-facing
  // PaymentsService.initPaystack, which accepts a caller-supplied amount
  // for legitimate partial/installment payments — a guardian self-service
  // "pay what I owe" flow doesn't need that, and computing it server-side
  // makes "you can only pay the real balance" a server-enforced invariant
  // rather than just a UI default. See this slice's plan-first §4.
  async initiate(
    guardianCtx: GuardianAuthContext,
    studentId: string,
    invoiceId: string,
    reqCtx: RequestContext,
  ): Promise<PaystackInitResponseDto> {
    const { paymentId, customerEmail, amount } = await withTenant(
      guardianCtx.schoolId,
      (db) =>
        withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
          const invoice = await db2.invoice.findUnique({
            where: { id: invoiceId },
            select: { id: true, studentId: true, status: true, totalDue: true, totalPaid: true },
          });
          // withGuardian already proved this guardian can see `studentId`
          // — it says nothing about whether `invoiceId` actually belongs
          // to that student, which is a separate check.
          if (!invoice || invoice.studentId !== studentId) {
            throw new NotFoundError("Invoice not found.");
          }
          if (invoice.status === "CANCELLED" || invoice.status === "REFUNDED") {
            throw new ConflictError(
              "INVOICE_NOT_PAYABLE",
              `Invoice cannot accept payments in status ${invoice.status}.`,
            );
          }

          const remaining = invoice.totalDue - invoice.totalPaid;
          if (remaining <= 0) {
            throw new ConflictError("INVOICE_ALREADY_PAID", "This invoice is already fully paid.");
          }

          // In-flight guard — see IN_FLIGHT_WINDOW_MS's own comment. Scoped
          // to this guardian-facing endpoint only, not a fix to the
          // shared webhook/apply path (see docs/deferred.md).
          const existingPending = await db2.payment.findFirst({
            where: {
              invoiceId,
              method: "PAYSTACK",
              status: "PENDING",
              createdAt: { gt: new Date(Date.now() - IN_FLIGHT_WINDOW_MS) },
            },
            select: { id: true },
          });
          if (existingPending) {
            throw new ConflictError(
              "PAYMENT_ALREADY_IN_PROGRESS",
              "A payment for this invoice is already in progress. Wait for it to complete, or try again in a few minutes.",
            );
          }

          // Customer email: the CALLING guardian's own, not the invoice's
          // primary guardian (unlike the staff flow's fallback lookup) —
          // Paystack sends its own receipt there, and the guardian paying
          // isn't necessarily the primary one.
          const guardian = await db2.guardian.findUnique({
            where: { id: guardianCtx.guardianId },
            select: { email: true },
          });
          const resolvedEmail =
            guardian?.email ?? `noreply-guardian-${guardianCtx.guardianId.slice(0, 8)}@schoolkit.ng`;

          const payment = await db2.payment.create({
            data: {
              schoolId: guardianCtx.schoolId,
              invoiceId,
              studentId,
              amount: remaining,
              method: "PAYSTACK",
              status: "PENDING",
              recordedBy: null, // no staff actor — see PortalPaymentDto's own comment
            },
            select: { id: true },
          });

          await db2.auditLog.create({
            data: {
              schoolId: guardianCtx.schoolId,
              // Guardian id, not a User id — audit_logs.user_id carries no
              // FK constraint (see portal-auth.service.ts's login/accept
              // audit writes for the identical precedent). "Who performed
              // this action" is the intent, not specifically a staff User.
              userId: guardianCtx.guardianId,
              action: AUDIT_INIT,
              entityType: "payment",
              entityId: payment.id,
              ipAddress: reqCtx.ipAddress,
              metadata: { invoiceId, amount: remaining },
            },
          });

          return { paymentId: payment.id, customerEmail: resolvedEmail, amount: remaining };
        }),
    );

    // Phase 2: call Paystack outside the DB transaction — avoids holding a
    // connection open during a network call. Same two-phase shape as the
    // staff flow's initPaystack.
    const paystackReference = `PSK-${guardianCtx.schoolId}-${paymentId}`;
    let initData: { authorization_url: string };
    try {
      initData = await this.paystack.initializeTransaction({
        amount,
        email: customerEmail,
        reference: paystackReference,
        // The one real divergence from the staff call site, which passes
        // no callbackUrl and relies on Paystack's dashboard-configured
        // default (apps/web) — that default would land a guardian on the
        // wrong app entirely.
        callbackUrl: `${portalBaseUrl()}/payments/callback`,
      });
    } catch (err) {
      this.logger.error(`Paystack init failed for guardian-initiated payment ${paymentId}: ${String(err)}`);
      await withTenant(guardianCtx.schoolId, (db) =>
        db.payment.update({ where: { id: paymentId }, data: { status: "FAILED" } }),
      );
      throw err;
    }

    await withTenant(guardianCtx.schoolId, (db) =>
      db.payment.update({ where: { id: paymentId }, data: { paystackReference } }),
    );

    return {
      authorizationUrl: initData.authorization_url,
      reference: paystackReference,
      paymentId,
    };
  }

  // GET /portal/payments/:reference
  //
  // Active verify-and-apply, delegating to PaymentsService.verifyAndApply —
  // the same narrow public method the staff verifyPaystack endpoint now
  // calls (see payments.service.ts). Superseded the original pure-read
  // design (see git history / journal for that reasoning): reporting only
  // came up short once actually checked — the callback page's ~20s polling
  // window can expire before the async webhook lands, and there is no
  // staff-side visibility into a guardian-initiated PENDING payment either,
  // so a guardian could be left with no real resolution path. This method
  // gives every poll a genuine independent chance to resolve the payment,
  // not just observe whatever the webhook happened to have already done.
  //
  // Authorization runs BEFORE any Paystack call: a plain tenant+guardian
  // lookup first (no verifyAndApply yet), so a cross-family/cross-tenant
  // caller is rejected without ever touching the Paystack API for a
  // reference they have no business polling.
  async verify(guardianCtx: GuardianAuthContext, reference: string): Promise<PortalPaymentDto> {
    const parsed = parsePaystackReference(reference);
    if (!parsed || parsed.schoolId !== guardianCtx.schoolId) {
      throw new NotFoundError("Payment not found.");
    }

    await withTenant(guardianCtx.schoolId, async (db) => {
      const payment = await db.payment.findUnique({
        where: { id: parsed.paymentId },
        select: { schoolId: true, studentId: true },
      });
      if (!payment || payment.schoolId !== guardianCtx.schoolId) {
        throw new NotFoundError("Payment not found.");
      }

      // withGuardian is checked AFTER partially resolving the resource —
      // can't check it before knowing which student the payment belongs
      // to, unlike every other portal endpoint so far where studentId is
      // a path param from the start.
      await withGuardian(guardianCtx.guardianId, payment.studentId, db, async () => undefined);
    });

    const dto = await this.paymentsService.verifyAndApply(guardianCtx.schoolId, reference);
    return toPortalPaymentDto(dto);
  }
}
