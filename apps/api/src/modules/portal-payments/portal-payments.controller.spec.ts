import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { INestApplication } from "@nestjs/common";
import request from "supertest";

import { basePrisma, withTenant } from "@school-kit/db";

import { HttpExceptionFilter } from "../../common/http-exception.filter";
import { createGuardianSession } from "../../common/auth/guardian-sessions";
import { PaystackService } from "../../common/paystack/paystack.service";
import { StorageModule } from "../../common/storage/storage.module";
import { PortalPaymentsModule } from "./portal-payments.module";

// Phase 4 / Slice 5 — same real-HTTP-through-GuardianAuthGuard discipline
// as Slices 3/4, plus payment-specific correctness this slice's plan-first
// named explicitly: kobo-exact server-computed amount, can't pay an
// already-fully-paid invoice, can't pay another family's invoice, and
// webhook idempotency for a guardian-initiated row (the shared webhook
// code is unchanged — this test is what actually proves that claim rather
// than just asserting it in a comment).

interface InitCallArgs {
  amount: number;
  email: string;
  reference: string;
  callbackUrl?: string;
}

function makePaystackStub() {
  return {
    initializeTransaction: vi.fn(async ({ reference }: InitCallArgs) => ({
      authorization_url: `https://checkout.paystack.com/${reference}`,
      access_code: `ac_${reference}`,
      reference,
    })),
    // Default: "abandoned", not "success" — the realistic state for a
    // checkout that was initiated but not (yet, or ever) completed.
    // verifyAndApply treats anything other than "success" as a failure,
    // so this is the default outcome for any test that doesn't
    // specifically mock a completed payment.
    verifyTransaction: vi.fn(async (reference: string) => ({
      status: "abandoned",
      reference,
      amount: 0,
      paid_at: null as string | null,
    })),
  };
}

describe("PortalPaymentsController (Phase 4 / Slice 5)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIdsToCleanup = new Set<string>();
  let app: INestApplication;
  const paystackStub = makePaystackStub();

  let schoolA: string;
  let schoolB: string;
  let guardianA1: string; // linked to studentA1 (ISSUED invoice, real balance)
  let guardianA2: string; // linked to studentA2 (fully PAID invoice)
  let guardianB1: string; // school B
  let studentA1: string;
  let studentA2: string;
  let studentB1: string;
  let invoiceA1: string; // balance = 500_000_00
  let invoiceA1Due: number;
  let invoiceA2Paid: string; // already fully paid
  let invoiceB1: string;
  let tokenA1: string;
  let tokenA2: string;
  let tokenB1: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // ConfigModule.forRoot + StorageModule weren't needed before this
      // slice's PaymentsModule import — PaymentsModule pulls in
      // PayrollModule, whose PayrollService constructor requires the real
      // (globally-registered) StorageService. PaymentsService itself also
      // needs a genuinely working StorageService: verifyAndApply's
      // success path generates a real receipt on disk, exercised by this
      // spec's own concurrency tests below. Mirrors AppModule's own
      // ConfigModule.forRoot + StorageModule wiring (see app.module.ts).
      imports: [ConfigModule.forRoot({ isGlobal: true }), StorageModule, PortalPaymentsModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(PaystackService)
      .useValue(paystackStub)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const schoolRowA = await basePrisma.school.create({
      data: { name: `Portal Payments Spec A ${runId}`, slug: `portal-payments-a-${runId}` },
      select: { id: true },
    });
    schoolA = schoolRowA.id;
    schoolIdsToCleanup.add(schoolA);

    const schoolRowB = await basePrisma.school.create({
      data: { name: `Portal Payments Spec B ${runId}`, slug: `portal-payments-b-${runId}` },
      select: { id: true },
    });
    schoolB = schoolRowB.id;
    schoolIdsToCleanup.add(schoolB);

    await withTenant(schoolA, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolA, label: `2025/2026-ppay-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId: schoolA, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      });

      const gA1 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Ada", lastName: `GuardianA1-${runId}`, relationship: "MOTHER", phone: `+234803${runId}1`, email: `guardian-a1-${runId}@example.test` },
        select: { id: true },
      });
      const gA2 = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Bola", lastName: `GuardianA2-${runId}`, relationship: "FATHER", phone: `+234803${runId}2` },
        select: { id: true },
      });
      guardianA1 = gA1.id;
      guardianA2 = gA2.id;

      const sA1 = await db.student.create({
        data: { schoolId: schoolA, admissionNumber: `ADM-PP-A1-${runId}`, firstName: "Student", lastName: `A1-${runId}`, dateOfBirth: new Date("2015-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      const sA2 = await db.student.create({
        data: { schoolId: schoolA, admissionNumber: `ADM-PP-A2-${runId}`, firstName: "Student", lastName: `A2-${runId}`, dateOfBirth: new Date("2016-01-01"), gender: "MALE" },
        select: { id: true },
      });
      studentA1 = sA1.id;
      studentA2 = sA2.id;

      await db.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentA1, guardianId: guardianA1, isPrimary: true, canPickup: true } });
      await db.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentA2, guardianId: guardianA2, isPrimary: true, canPickup: true } });

      invoiceA1Due = 500_000_00;
      const invA1 = await db.invoice.create({
        data: {
          schoolId: schoolA, studentId: studentA1, termId: term.id, academicYearId: year.id,
          status: "ISSUED", items: [], totalAmount: invoiceA1Due, totalDiscount: 0,
          totalDue: invoiceA1Due, totalPaid: 0, issuedAt: new Date(),
        },
        select: { id: true },
      });
      invoiceA1 = invA1.id;

      const invA2 = await db.invoice.create({
        data: {
          schoolId: schoolA, studentId: studentA2, termId: term.id, academicYearId: year.id,
          status: "PAID", items: [], totalAmount: 200_000_00, totalDiscount: 0,
          totalDue: 200_000_00, totalPaid: 200_000_00, issuedAt: new Date(),
        },
        select: { id: true },
      });
      invoiceA2Paid = invA2.id;
    });

    await withTenant(schoolB, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolB, label: `2025/2026-ppay-b-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId: schoolB, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      });

      const gB1 = await db.guardian.create({
        data: { schoolId: schoolB, firstName: "Dupe", lastName: `GuardianB1-${runId}`, relationship: "MOTHER", phone: `+234803${runId}3` },
        select: { id: true },
      });
      guardianB1 = gB1.id;

      const sB1 = await db.student.create({
        data: { schoolId: schoolB, admissionNumber: `ADM-PP-B1-${runId}`, firstName: "Student", lastName: `B1-${runId}`, dateOfBirth: new Date("2015-06-01"), gender: "OTHER" },
        select: { id: true },
      });
      studentB1 = sB1.id;

      await db.studentGuardian.create({ data: { schoolId: schoolB, studentId: studentB1, guardianId: guardianB1, isPrimary: true, canPickup: true } });

      const invB1 = await db.invoice.create({
        data: {
          schoolId: schoolB, studentId: studentB1, termId: term.id, academicYearId: year.id,
          status: "ISSUED", items: [], totalAmount: 100_000_00, totalDiscount: 0,
          totalDue: 100_000_00, totalPaid: 0, issuedAt: new Date(),
        },
        select: { id: true },
      });
      invoiceB1 = invB1.id;
    });

    ({ rawToken: tokenA1 } = await createGuardianSession(schoolA, guardianA1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenA2 } = await createGuardianSession(schoolA, guardianA2, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
    ({ rawToken: tokenB1 } = await createGuardianSession(schoolB, guardianB1, { ipAddress: "127.0.0.1", userAgent: "vitest" }));
  });

  afterAll(async () => {
    await app.close();
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ---------------------------------------------------------------------
  // POST /portal/students/:id/invoices/:invoiceId/pay
  // ---------------------------------------------------------------------

  it("happy path: creates a PENDING payment for the exact outstanding balance, kobo-precise, and calls Paystack with it", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentA1}/invoices/${invoiceA1}/pay`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(200);
    expect(res.body.authorizationUrl).toContain("checkout.paystack.com");
    expect(res.body.reference).toMatch(/^PSK-[0-9a-f-]{36}-[0-9a-f-]{36}$/);
    expect(res.body.paymentId).toBeTruthy();

    const payment = await withTenant(schoolA, (db) =>
      db.payment.findUniqueOrThrow({
        where: { id: res.body.paymentId },
        select: { status: true, method: true, amount: true, paystackReference: true, recordedBy: true },
      }),
    );
    expect(payment.status).toBe("PENDING");
    expect(payment.method).toBe("PAYSTACK");
    expect(payment.amount).toBe(invoiceA1Due); // kobo-exact — no partial amount possible
    expect(payment.paystackReference).toBe(res.body.reference);
    expect(payment.recordedBy).toBeNull(); // no staff actor

    const initCall = paystackStub.initializeTransaction.mock.calls.at(-1)?.[0];
    expect(initCall).toBeDefined();
    if (!initCall) throw new Error("unreachable — asserted above");
    expect(initCall.amount).toBe(invoiceA1Due);
    expect(initCall.email).toBe(`guardian-a1-${runId}@example.test`); // the CALLING guardian's own email
    expect(initCall.callbackUrl).toContain("/payments/callback");
  });

  it("cannot pay an already-fully-paid invoice → INVOICE_ALREADY_PAID", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentA2}/invoices/${invoiceA2Paid}/pay`)
      .set("Authorization", `Bearer ${tokenA2}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVOICE_ALREADY_PAID");
  });

  it("a second attempt while one is already in-flight → PAYMENT_ALREADY_IN_PROGRESS", async () => {
    const { schoolId, studentId, invoiceId, guardianId, token } = await seedFreshInvoice("inflight");

    const first = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PAYMENT_ALREADY_IN_PROGRESS");

    void schoolId;
    void guardianId;
  });

  it("SAME-SCHOOL cross-guardian block: guardian A1 cannot pay A2's child's invoice", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentA2}/invoices/${invoiceA2Paid}/pay`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("CROSS-TENANT block: guardian A1 cannot pay school B's child's invoice", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentB1}/invoices/${invoiceB1}/pay`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("guardian B1 (school B) cannot pay school A's invoice either, symmetrically", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentA1}/invoices/${invoiceA1}/pay`)
      .set("Authorization", `Bearer ${tokenB1}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("no bearer token → 401", async () => {
    const res = await request(app.getHttpServer()).post(
      `/api/v1/portal/students/${studentA1}/invoices/${invoiceA1}/pay`,
    );
    expect(res.status).toBe(401);
  });

  it("marks the payment FAILED and returns an error if the Paystack API call itself fails", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("apifail");
    paystackStub.initializeTransaction.mockRejectedValueOnce(new Error("Paystack API down"));

    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(500);

    const payments = await withTenant(schoolA, (db) =>
      db.payment.findMany({ where: { invoiceId }, select: { status: true } }),
    );
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe("FAILED");
  });

  // ---------------------------------------------------------------------
  // GET /portal/payments/:reference — active verify-and-apply
  //
  // This is no longer a passive read: it delegates to the same
  // PaymentsService.verifyAndApply the staff endpoint uses, so every poll
  // genuinely calls Paystack and applies whatever it reports. See
  // payments.service.spec.ts for verifyAndApply's own unit coverage
  // (terminal short-circuit, atomic claim) — these tests cover the
  // guardian-facing wrapper: authorization-before-Paystack-call, DTO
  // shape, and the two real outcomes (confirmed vs. not-yet-completed).
  // ---------------------------------------------------------------------

  it("verify: actively confirms a completed payment against Paystack (PENDING → SUCCESS)", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("verify-success");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(init.status).toBe(200);

    paystackStub.verifyTransaction.mockResolvedValueOnce({
      status: "success",
      reference: init.body.reference,
      amount: invoiceA1Due,
      paid_at: new Date().toISOString(),
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/payments/${init.body.reference}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(init.body.paymentId);
    expect(res.body.status).toBe("SUCCESS");
    expect(res.body.method).toBe("PAYSTACK");

    const invoice = await withTenant(schoolA, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );
    expect(invoice.totalPaid).toBe(invoiceA1Due);
    expect(invoice.status).toBe("PAID");
  });

  it("verify: reports FAILED when Paystack has nothing successful to confirm yet", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("verify-not-yet");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(init.status).toBe(200);

    // Default stub resolves "abandoned" — the guardian never completed
    // checkout (or Paystack hasn't finished processing it).
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/payments/${init.body.reference}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(init.body.paymentId);
    expect(res.body.status).toBe("FAILED");
  });

  it("verify: SAME-SCHOOL cross-guardian block — rejected before any Paystack call", async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentA1}/invoices/${invoiceA1}/pay`)
      .set("Authorization", `Bearer ${tokenA1}`);
    // invoiceA1 already has an in-flight payment from an earlier test in
    // this file — that's fine, this test only needs SOME reference minted
    // for guardian A1, whether this call succeeds or 409s.
    const reference =
      res.status === 200
        ? res.body.reference
        : (
            await withTenant(schoolA, (db) =>
              db.payment.findFirstOrThrow({ where: { invoiceId: invoiceA1 }, select: { paystackReference: true } }),
            )
          ).paystackReference;

    const callsBefore = paystackStub.verifyTransaction.mock.calls.length;
    const readAsWrongGuardian = await request(app.getHttpServer())
      .get(`/api/v1/portal/payments/${reference}`)
      .set("Authorization", `Bearer ${tokenA2}`);
    expect(readAsWrongGuardian.status).toBe(403);
    expect(readAsWrongGuardian.body.error.code).toBe("FORBIDDEN");
    // Authorization runs before verifyAndApply — a guardian with no
    // business polling this reference never causes a Paystack API call.
    expect(paystackStub.verifyTransaction.mock.calls.length).toBe(callsBefore);
  });

  it("verify: an unrecognized/malformed reference → 404, not a crash", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/payments/not-a-real-reference`)
      .set("Authorization", `Bearer ${tokenA1}`);
    expect(res.status).toBe(404);
  });

  it("response contains exactly the narrow portal field set — no schoolId/recordedBy leak through", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("shape");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/payments/${init.body.reference}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["id", "invoiceId", "studentId", "amount", "method", "status", "paidAt", "createdAt", "updatedAt"].sort(),
    );
  });

  // ---------------------------------------------------------------------
  // verifyAndApply concurrency — two independent triggers (guardian poll
  // + webhook) can now race to apply the same result. Proving it, not
  // just asserting it, mirrors the existing webhook-replay test's own
  // discipline below.
  // ---------------------------------------------------------------------

  it("two concurrent guardian polls of the same reference apply the success exactly once", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("verify-concurrent-poll");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(init.status).toBe(200);
    const { reference, paymentId } = init.body;

    paystackStub.verifyTransaction.mockResolvedValue({
      status: "success",
      reference,
      amount: invoiceA1Due,
      paid_at: new Date().toISOString(),
    });

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).get(`/api/v1/portal/payments/${reference}`).set("Authorization", `Bearer ${token}`),
      request(app.getHttpServer()).get(`/api/v1/portal/payments/${reference}`).set("Authorization", `Bearer ${token}`),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.status).toBe("SUCCESS");
    expect(second.body.status).toBe("SUCCESS");

    const invoice = await withTenant(schoolA, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );
    // Not doubled — proves the atomic claim, not just that both responses
    // happened to look right.
    expect(invoice.totalPaid).toBe(invoiceA1Due);
    expect(invoice.status).toBe("PAID");

    const confirmRows = await withTenant(schoolA, (db) =>
      db.auditLog.findMany({ where: { action: "payment.paystack-confirm", entityId: paymentId } }),
    );
    expect(confirmRows).toHaveLength(1);
  });

  it("a guardian poll racing the webhook for the same payment applies once, not twice", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("verify-race-webhook");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(init.status).toBe(200);
    const { reference, paymentId } = init.body;

    paystackStub.verifyTransaction.mockResolvedValue({
      status: "success",
      reference,
      amount: invoiceA1Due,
      paid_at: new Date().toISOString(),
    });

    const os = await import("node:os");
    const path = await import("node:path");
    const { PaymentsService } = await import("../payments/payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const { PaymentPlanService } = await import("../payments/payment-plan.service.js");

    const storage = new StorageService(
      new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-portal-pay-race-${runId}`), {
        baseUrl: "http://localhost:4000/api/v1",
        secret: "test-secret",
      }),
    );
    const paymentsSvc = new PaymentsService(storage, paystackStub as never, new PaymentPlanService());

    const event = {
      event: "charge.success",
      data: { reference, status: "success", amount: invoiceA1Due, paid_at: new Date().toISOString() },
    };

    const [pollRes] = await Promise.all([
      request(app.getHttpServer()).get(`/api/v1/portal/payments/${reference}`).set("Authorization", `Bearer ${token}`),
      paymentsSvc.handleWebhook(event),
    ]);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.status).toBe("SUCCESS");

    const invoice = await withTenant(schoolA, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );
    expect(invoice.totalPaid).toBe(invoiceA1Due);
    expect(invoice.status).toBe("PAID");

    const confirmRows = await withTenant(schoolA, (db) =>
      db.auditLog.findMany({ where: { action: "payment.paystack-confirm", entityId: paymentId } }),
    );
    expect(confirmRows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Webhook idempotency — the shared, unchanged code path, exercised
  // against a guardian-initiated row specifically (see this file's own
  // header comment for why this matters more than a comment claiming it).
  // ---------------------------------------------------------------------

  it("a duplicate charge.success webhook for a guardian-initiated payment applies once, not twice", async () => {
    const { studentId, invoiceId, token } = await seedFreshInvoice("webhook");
    const init = await request(app.getHttpServer())
      .post(`/api/v1/portal/students/${studentId}/invoices/${invoiceId}/pay`)
      .set("Authorization", `Bearer ${token}`);
    expect(init.status).toBe(200);
    const { reference, paymentId } = init.body;

    const os = await import("node:os");
    const path = await import("node:path");
    const { PaymentsService } = await import("../payments/payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const { PaymentPlanService } = await import("../payments/payment-plan.service.js");

    const storage = new StorageService(
      new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-portal-pay-webhook-${runId}`), {
        baseUrl: "http://localhost:4000/api/v1",
        secret: "test-secret",
      }),
    );
    const paymentsSvc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const event = {
      event: "charge.success",
      data: { reference, status: "success", amount: invoiceA1Due, paid_at: new Date().toISOString() },
    };

    await paymentsSvc.handleWebhook(event);
    const afterFirst = await withTenant(schoolA, (db) =>
      db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
    );
    expect(afterFirst.status).toBe("SUCCESS");

    const invoiceAfterFirst = await withTenant(schoolA, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );

    // Replay the SAME event a second time.
    await paymentsSvc.handleWebhook(event);

    const invoiceAfterSecond = await withTenant(schoolA, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );
    expect(invoiceAfterSecond.totalPaid).toBe(invoiceAfterFirst.totalPaid);
    expect(invoiceAfterSecond.status).toBe(invoiceAfterFirst.status);
  });

  // ---------------------------------------------------------------------
  // Shared fixture — a fresh ISSUED invoice + guardian + student, isolated
  // per test so the in-flight/webhook tests don't collide with each other
  // or with the beforeAll-seeded fixtures.
  // ---------------------------------------------------------------------

  async function seedFreshInvoice(suffix: string) {
    const seeded = await withTenant(schoolA, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolA, label: `2025/2026-ppay-${suffix}-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: { schoolId: schoolA, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      });
      const guardian = await db.guardian.create({
        data: { schoolId: schoolA, firstName: "Extra", lastName: `Guardian-${suffix}-${runId}`, relationship: "MOTHER", phone: `+234804${runId}${suffix.length}` },
        select: { id: true },
      });
      const student = await db.student.create({
        data: { schoolId: schoolA, admissionNumber: `ADM-PP-${suffix}-${runId}`, firstName: "Student", lastName: `${suffix}-${runId}`, dateOfBirth: new Date("2015-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      await db.studentGuardian.create({
        data: { schoolId: schoolA, studentId: student.id, guardianId: guardian.id, isPrimary: true, canPickup: true },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId: schoolA, studentId: student.id, termId: term.id, academicYearId: year.id,
          status: "ISSUED", items: [], totalAmount: invoiceA1Due, totalDiscount: 0,
          totalDue: invoiceA1Due, totalPaid: 0, issuedAt: new Date(),
        },
        select: { id: true },
      });
      return { guardianId: guardian.id, studentId: student.id, invoiceId: invoice.id };
    });

    // createGuardianSession opens its own withTenant transaction — must run
    // AFTER the outer one above closes, not nested inside it. Nesting it
    // meant the inner transaction's guardian_sessions INSERT ran without
    // the outer transaction's app.current_school_id GUC in scope (each
    // withTenant call gets its own SET LOCAL, scoped to its own
    // transaction), which FORCE RLS correctly rejected. Found by actually
    // running this suite, not just typechecking it.
    const { rawToken } = await createGuardianSession(schoolA, seeded.guardianId, {
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
    });

    return { schoolId: schoolA, ...seeded, token: rawToken };
  }
});
