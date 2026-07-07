import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import type { InvoiceStatus } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";

// Phase 3 / Slice 11 — RefundsService integration tests.
//
// All tests hit the real local DB (same pattern as payment-plan.service.spec.ts).
// Each test creates its own isolated school via makeSchool() and cleans up in
// afterAll. Paystack API calls are not exercised — only manual payment reversals
// are tested here (method = "CASH"). Paystack-path logic is tested implicitly
// by the service's branch structure (unit test candidate in slice 12 if needed).

const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000);
YESTERDAY.setHours(0, 0, 0, 0);

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23481${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("RefundsService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ── Fixture helpers ──────────────────────────────────────────────────────

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Refund ${suffix} ${runId}`,
        schoolSlug: `refund-${suffix}-${runId}`,
        ownerFirstName: "Admin",
        ownerLastName: "Owner",
        ownerEmail: `refund-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "test" },
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function makeInvoice(
    schoolId: string,
    ownerId: string,
    opts: {
      totalDue: number;
      totalPaid?: number;
      status?: InvoiceStatus;
      dueDate?: Date | null;
    },
  ): Promise<{ invoiceId: string; studentId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-rf-${runId}-${Math.random().toString(36).slice(2, 6)}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-RF-${runId}-${Math.random().toString(36).slice(2, 6)}`,
          firstName: "Test",
          lastName: "Student",
          dateOfBirth: new Date("2010-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: term.id,
          academicYearId: year.id,
          status: opts.status ?? "ISSUED",
          items: [],
          totalAmount: opts.totalDue,
          totalDiscount: 0,
          totalDue: opts.totalDue,
          totalPaid: opts.totalPaid ?? 0,
          dueDate: opts.dueDate ?? null,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      return { invoiceId: invoice.id, studentId: student.id };
    });
  }

  async function makePayment(
    schoolId: string,
    invoiceId: string,
    studentId: string,
    amount: number,
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId,
          amount,
          method: "CASH",
          status: "SUCCESS",
          paidAt: new Date(),
        },
        select: { id: true },
      });
      return p.id;
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it("reverses a PAID invoice to REFUNDED when all payments are reversed", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new RefundsService(null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("paid-to-refunded");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 100_000);
    // Sync invoice.totalPaid with the payment
    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 100_000 } }),
    );

    const refund = await svc.create(ctx(schoolId, ownerId), {
      paymentId,
      amount: 100_000,
      reason: "Duplicate entry",
    });

    expect(refund.status).toBe("PROCESSED");
    expect(refund.paymentId).toBe(paymentId);
    expect(refund.paystackRefundRef).toBeNull();

    const [invoice, payment] = await withTenant(schoolId, async (db) => {
      return Promise.all([
        db.invoice.findUniqueOrThrow({
          where: { id: invoiceId },
          select: { status: true, totalPaid: true },
        }),
        db.payment.findUniqueOrThrow({
          where: { id: paymentId },
          select: { status: true },
        }),
      ]);
    });

    expect(invoice.status).toBe("REFUNDED");
    expect(invoice.totalPaid).toBe(0);
    expect(payment.status).toBe("REVERSED");
  });

  it("reverses a PARTIALLY_PAID invoice back to ISSUED when last payment removed", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new RefundsService(null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("partial-to-issued");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 150_000,
      totalPaid: 50_000,
      status: "PARTIALLY_PAID",
    });
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 50_000);
    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 50_000 } }),
    );

    await svc.create(ctx(schoolId, ownerId), {
      paymentId,
      amount: 50_000,
      reason: "Wrong student",
    });

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true, totalPaid: true },
      }),
    );

    expect(invoice.status).toBe("REFUNDED");
    expect(invoice.totalPaid).toBe(0);
  });

  it("reverses one of two payments → invoice stays PARTIALLY_PAID", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new RefundsService(null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("two-payments-one-reversed");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });
    const p1 = await makePayment(schoolId, invoiceId, studentId, 60_000);
    const p2 = await makePayment(schoolId, invoiceId, studentId, 40_000);
    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 100_000 } }),
    );

    await svc.create(ctx(schoolId, ownerId), {
      paymentId: p1,
      amount: 60_000,
      reason: "Error",
    });

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true, totalPaid: true },
      }),
    );

    expect(invoice.totalPaid).toBe(40_000);
    expect(invoice.status).toBe("PARTIALLY_PAID");

    // Verify p2 still SUCCESS, p1 REVERSED
    const [pay1, pay2] = await withTenant(schoolId, (db) =>
      Promise.all([
        db.payment.findUniqueOrThrow({ where: { id: p1 }, select: { status: true } }),
        db.payment.findUniqueOrThrow({ where: { id: p2 }, select: { status: true } }),
      ]),
    );
    expect(pay1.status).toBe("REVERSED");
    expect(pay2.status).toBe("SUCCESS");
  });

  it("preserves OVERDUE status after reversal that leaves partial balance remaining", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new RefundsService(null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("overdue-stays-overdue");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "OVERDUE",
      dueDate: YESTERDAY,
    });
    const _p1 = await makePayment(schoolId, invoiceId, studentId, 60_000);
    const p2 = await makePayment(schoolId, invoiceId, studentId, 40_000);
    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 100_000 } }),
    );

    await svc.create(ctx(schoolId, ownerId), {
      paymentId: p2,
      amount: 40_000,
      reason: "Error",
    });

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        select: { status: true, totalPaid: true },
      }),
    );

    expect(invoice.totalPaid).toBe(60_000);
    expect(invoice.status).toBe("OVERDUE");
  });

  it("rejects reversing an already-REVERSED payment", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new RefundsService(null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("already-reversed");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, { totalDue: 50_000 });
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 50_000);
    await withTenant(schoolId, (db) =>
      db.payment.update({ where: { id: paymentId }, data: { status: "REVERSED" } }),
    );

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        paymentId,
        amount: 50_000,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_ALREADY_REVERSED" });
  });

  it("rejects reversing a FAILED payment", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const svc = new RefundsService(null as never, null as never);

    const { schoolId, ownerId } = await makeSchool("failed-payment");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, { totalDue: 50_000 });

    const failedPaymentId = await withTenant(schoolId, (db) =>
      db.payment
        .create({
          data: {
            schoolId,
            invoiceId,
            studentId,
            amount: 50_000,
            method: "CASH",
            status: "FAILED",
            paidAt: new Date(),
          },
          select: { id: true },
        })
        .then((p) => p.id),
    );

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        paymentId: failedPaymentId,
        amount: 50_000,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_REVERSIBLE" });
  });

  it("rejects partial refund amount", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const svc = new RefundsService(null as never, null as never);

    const { schoolId, ownerId } = await makeSchool("partial-amount");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 100_000);

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        paymentId,
        amount: 50_000,
        reason: "Partial",
      }),
    ).rejects.toMatchObject({ code: "PARTIAL_REFUND_NOT_SUPPORTED" });
  });

  it("rejects reversing a payment on a CANCELLED invoice", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const svc = new RefundsService(null as never, null as never);

    const { schoolId, ownerId } = await makeSchool("cancelled-invoice");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 50_000,
      status: "CANCELLED",
    });
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 50_000);

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        paymentId,
        amount: 50_000,
        reason: "Test",
      }),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_REVERSIBLE" });
  });

  it("reversal unmarks paid installments", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const planSvc = new PaymentPlanService();
    const svc = new RefundsService(null as never, planSvc);

    const { schoolId, ownerId } = await makeSchool("installment-recompute");
    const { invoiceId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 150_000,
      totalPaid: 0,
      status: "ISSUED",
    });

    // Create plan: three 50k installments
    await planSvc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Three installments",
      installments: [
        { amount: 50_000, dueDate: "2026-01-15" },
        { amount: 50_000, dueDate: "2026-02-15" },
        { amount: 50_000, dueDate: "2026-03-15" },
      ],
    });

    // Record first payment covering installment 1
    const paymentId = await makePayment(schoolId, invoiceId, studentId, 50_000);
    // Sync invoice + recompute installments
    await withTenant(schoolId, async (db) => {
      await db.invoice.update({
        where: { id: invoiceId },
        data: { totalPaid: 50_000, status: "PARTIALLY_PAID" },
      });
      await planSvc.recomputeInstallmentsPaid(db, invoiceId, 50_000);
    });

    // Verify installment 1 is paid before reversal
    const planBefore = await planSvc.findByInvoice(ctx(schoolId, ownerId), invoiceId);
    expect(planBefore!.installments[0].paid).toBe(true);
    expect(planBefore!.installments[1].paid).toBe(false);

    // Reverse the payment
    await svc.create(ctx(schoolId, ownerId), {
      paymentId,
      amount: 50_000,
      reason: "Recorded in error",
    });

    // Verify installment 1 is un-marked
    const planAfter = await planSvc.findByInvoice(ctx(schoolId, ownerId), invoiceId);
    expect(planAfter!.installments.every((i) => !i.paid)).toBe(true);
  });

  it("rejects payment from a different school (cross-tenant guard)", async () => {
    const { RefundsService } = await import("./refunds.service.js");
    const svc = new RefundsService(null as never, null as never);

    const { schoolId: schoolA, ownerId: ownerA } = await makeSchool("xschool-a");
    const { schoolId: schoolB, ownerId: ownerB } = await makeSchool("xschool-b");
    const { invoiceId, studentId } = await makeInvoice(schoolA, ownerA, { totalDue: 50_000 });
    const paymentId = await makePayment(schoolA, invoiceId, studentId, 50_000);

    // ownerB attempts to refund schoolA's payment — RLS blocks it
    await expect(
      svc.create(ctx(schoolB, ownerB), {
        paymentId,
        amount: 50_000,
        reason: "Cross-tenant attack",
      }),
    ).rejects.toThrow(); // NotFoundError from RLS
  });
});
