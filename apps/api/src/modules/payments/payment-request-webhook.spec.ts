import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { PaymentLinkInvalidationService } from "../invoices/payment-link-invalidation.service.js";
import { InvoiceGenerationService } from "../invoices/invoice-generation.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { PaymentsService } from "./payments.service.js";
import { RefundsService } from "./refunds.service.js";

describe("paymentrequest.success — real database application", () => {
  const runId = Math.random().toString(36).slice(2, 9);
  const reference = `CP3-${runId}`;
  let schoolId: string;
  let invoiceId: string;
  let linkId: string;
  let userId: string;
  const archivePaymentRequest = vi.fn(async () => undefined);

  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: {
        name: `CP3 webhook ${runId}`,
        slug: `cp3-webhook-${runId}`,
        status: "ACTIVE",
        paystackPaymentsEnabled: true,
        paystackSubaccountCode: "ACCT_cp3",
        paystackSplitCode: "SPL_cp3",
      },
    });
    schoolId = school.id;
    const fixture = await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: { schoolId, firstName: "CP3", lastName: "Operator" },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId,
          studentId: `student-${runId}`,
          termId: `term-${runId}`,
          academicYearId: `year-${runId}`,
          items: [],
          totalAmount: 180_000,
          totalDiscount: 0,
          totalDue: 180_000,
          issuedAt: new Date(),
          issuedBy: user.id,
        },
      });
      const link = await db.paymentLink.create({
        data: {
          schoolId,
          invoiceId: invoice.id,
          requestId: 999001n,
          requestCode: `PRQ_${runId}`,
          hostedUrl: `https://paystack.com/pay/PRQ_${runId}`,
          paystackCustomerCode: "CUS_cp3",
          amount: 180_000,
          status: "LIVE",
          createdBy: user.id,
        },
      });
      return { user, invoice, link };
    });
    userId = fixture.user.id;
    invoiceId = fixture.invoice.id;
    linkId = fixture.link.id;
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("credits once, updates the invoice, consumes the link, and archives remotely", async () => {
    const metadata = { schoolKitPaymentLinkId: linkId, schoolId, invoiceId };
    const paystack = {
      getPaymentRequest: vi.fn(async () => ({
        id: 999001,
        request_code: `PRQ_${runId}`,
        amount: 180_000,
        currency: "NGN",
        status: "success",
        archived: false,
        split_code: "SPL_cp3",
        metadata,
        customer: { customer_code: "CUS_cp3", email: `noreply-payment-${linkId}@schoolkit.ng` },
        transactions: [{ reference, status: "success", amount: 180_000, currency: "NGN" }],
      })),
      verifyTransaction: vi.fn(async () => ({
        status: "success",
        reference,
        amount: 180_000,
        paid_at: "2026-08-22T17:00:00.000Z",
        metadata: { referrer: `https://paystack.shop/pay/PRQ_${runId}` },
        channel: "card",
        currency: "NGN",
        fees: 2_700,
        customer: { email: `noreply-payment-${linkId}@schoolkit.ng` },
        split: { split_code: "SPL_cp3" },
      })),
      archivePaymentRequest,
    };
    const invalidation = new PaymentLinkInvalidationService(paystack as never);
    const service = new PaymentsService(
      { put: vi.fn() } as never,
      paystack as never,
      new PaymentPlanService(),
      invalidation,
    );
    const event = {
      event: "paymentrequest.success",
      data: {
        reference,
        status: "success",
        amount: 180_000,
        paid_at: "2026-08-22T17:00:00.000Z",
        metadata,
        transaction: { reference },
      },
    };

    await Promise.all([
      service.handlePaymentRequestWebhook(event),
      service.handlePaymentRequestWebhook(event),
    ]);
    await service.handlePaymentRequestWebhook(event);

    const state = await withTenant(schoolId, async (db) => ({
      invoice: await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
      link: await db.paymentLink.findUniqueOrThrow({ where: { id: linkId } }),
      payments: await db.payment.findMany({ where: { invoiceId } }),
      paymentAudits: await db.auditLog.count({ where: { action: "payment.paystack-confirm", entityType: "payment" } }),
      linkAudits: await db.auditLog.count({ where: { action: "payment-link.paid", entityId: linkId } }),
    }));
    expect(state.invoice).toMatchObject({ totalPaid: 180_000, status: "PAID" });
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({
      schoolId,
      invoiceId,
      amount: 180_000,
      status: "SUCCESS",
      paystackReference: reference,
      recordedBy: userId,
    });
    expect(state.link).toMatchObject({ status: "PAID", hostedUrl: null });
    expect(state.link.archivedAt).toBeInstanceOf(Date);
    expect(state.paymentAudits).toBe(1);
    expect(state.linkAudits).toBe(1);
    expect(archivePaymentRequest).toHaveBeenCalledTimes(1);
    expect(archivePaymentRequest).toHaveBeenCalledWith(`PRQ_${runId}`);
  });

  it("invalidates links after manual payment, refund, and invoice cancellation commits", async () => {
    archivePaymentRequest.mockClear();
    const paystack = { archivePaymentRequest };
    const invalidation = new PaymentLinkInvalidationService(paystack as never);
    const plan = new PaymentPlanService();
    const payments = new PaymentsService(
      { put: vi.fn(async () => "receipts/cp3.html") } as never,
      paystack as never,
      plan,
      invalidation,
    );
    const refunds = new RefundsService(paystack as never, plan, invalidation);
    const invoices = new InvoiceGenerationService(invalidation);

    const fixture = await withTenant(schoolId, async (db) => {
      const makeInvoiceAndLink = async (suffix: string) => {
        const invoice = await db.invoice.create({
          data: {
            schoolId,
            studentId: `student-${suffix}-${runId}`,
            termId: `term-${suffix}-${runId}`,
            academicYearId: `year-${suffix}-${runId}`,
            items: [],
            totalAmount: 90_000,
            totalDiscount: 0,
            totalDue: 90_000,
            issuedAt: new Date(),
            issuedBy: userId,
          },
        });
        const link = await db.paymentLink.create({
          data: {
            schoolId,
            invoiceId: invoice.id,
            requestId: BigInt(`88${suffix === "manual" ? "01" : "02"}`),
            requestCode: `PRQ_${suffix}_${runId}`,
            hostedUrl: `https://paystack.com/pay/PRQ_${suffix}_${runId}`,
            paystackCustomerCode: `CUS_${suffix}`,
            amount: 90_000,
            status: "LIVE",
            createdBy: userId,
          },
        });
        return { invoice, link };
      };
      return {
        manual: await makeInvoiceAndLink("manual"),
        cancel: await makeInvoiceAndLink("cancel"),
      };
    });
    const auth = { sessionId: "cp3-invalidation", schoolId, userId };
    const manual = await payments.recordManual(
      auth,
      {
        invoiceId: fixture.manual.invoice.id,
        amount: 90_000,
        method: "CASH",
        paidAt: new Date().toISOString(),
      },
      { ipAddress: "127.0.0.1" },
    );
    const replacement = await withTenant(schoolId, (db) =>
      db.paymentLink.create({
        data: {
          schoolId,
          invoiceId: fixture.manual.invoice.id,
          requestId: 8803n,
          requestCode: `PRQ_refund_${runId}`,
          hostedUrl: `https://paystack.com/pay/PRQ_refund_${runId}`,
          paystackCustomerCode: "CUS_refund",
          amount: 90_000,
          status: "LIVE",
          createdBy: userId,
        },
      }),
    );
    await refunds.create(auth, {
      paymentId: manual.id,
      amount: 90_000,
      reason: "CP3 invalidation proof",
    });
    await invoices.cancel(auth, fixture.cancel.invoice.id, { ipAddress: "127.0.0.1" });

    const states = await withTenant(schoolId, (db) =>
      db.paymentLink.findMany({
        where: { id: { in: [fixture.manual.link.id, replacement.id, fixture.cancel.link.id] } },
        select: { id: true, status: true, hostedUrl: true, archivedAt: true },
      }),
    );
    expect(states).toHaveLength(3);
    expect(states).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: fixture.manual.link.id, status: "ARCHIVED", hostedUrl: null }),
        expect.objectContaining({ id: replacement.id, status: "ARCHIVED", hostedUrl: null }),
        expect.objectContaining({ id: fixture.cancel.link.id, status: "ARCHIVED", hostedUrl: null }),
      ]),
    );
    expect(states.every(({ archivedAt }) => archivedAt instanceof Date)).toBe(true);
    expect(archivePaymentRequest).toHaveBeenCalledTimes(3);
  });
});
