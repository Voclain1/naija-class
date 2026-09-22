import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { recordManualPaymentSchema } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { computeInvoiceStatus, parsePaystackReference } from "./payments.service.js";

// Phase 3 / Slice 7 CP1 — payments service spec.
//
// Part 1 (describe "computeInvoiceStatus"): pure-function unit tests — no DB.
//   Covers: ISSUED / PARTIALLY_PAID / PAID transitions, zero, equal, greater.
//
// Part 2 (describe "PaymentsService"): integration tests — real DB.
//   Covers: recordManual happy paths (single full payment, two partials),
//   rejection of payments on CANCELLED invoice, overpayment rejection,
//   zero-amount rejection, findAll pagination, audit log row written.
//
// Part 3 (describe "parsePaystackReference"): pure-function unit tests — no DB.
//   Covers reference parsing, malformed inputs.
//
// Part 4 (describe "PaymentsService — Paystack methods"): integration tests.
//   Covers: initPaystack happy path + guards, handleWebhook charge.success +
//   charge.failed + idempotency + unknown event, verifyPaystack self-heal +
//   idempotency + cross-school guard.

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — computeInvoiceStatus (pure unit — no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeInvoiceStatus", () => {
  it("0 paid → ISSUED", () => {
    expect(computeInvoiceStatus(0, 100_000)).toBe("ISSUED");
  });

  it("negative paid (guard) → ISSUED", () => {
    expect(computeInvoiceStatus(-1, 100_000)).toBe("ISSUED");
  });

  it("partial paid → PARTIALLY_PAID", () => {
    expect(computeInvoiceStatus(50_000, 100_000)).toBe("PARTIALLY_PAID");
  });

  it("1 kobo remaining → PARTIALLY_PAID", () => {
    expect(computeInvoiceStatus(99_999, 100_000)).toBe("PARTIALLY_PAID");
  });

  it("exact balance paid → PAID", () => {
    expect(computeInvoiceStatus(100_000, 100_000)).toBe("PAID");
  });

  it("totalPaid > totalDue (edge case) → PAID", () => {
    // Overpayment is rejected before this function is called, but the fn
    // itself is permissive so slice 8 Paystack confirmations work cleanly.
    expect(computeInvoiceStatus(100_001, 100_000)).toBe("PAID");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — PaymentsService integration tests (real DB)
// ─────────────────────────────────────────────────────────────────────────────

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

const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };

describe("PaymentsService (integration)", () => {
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
        schoolName: `Pay ${suffix} ${runId}`,
        schoolSlug: `pay-${suffix}-${runId}`,
        ownerFirstName: "Chidi",
        ownerLastName: "Admin",
        ownerEmail: `pay-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function makeIssuedInvoice(
    schoolId: string,
    ownerId: string,
    totalDue: number,
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-pay-${runId}`,
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
          admissionNumber: `ADM-PAY-${runId}`,
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
          status: "ISSUED",
          items: [],
          totalAmount: totalDue,
          totalDiscount: 0,
          totalDue,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      return invoice.id;
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it("single full payment → invoice status transitions to PAID", async () => {
    // Import PaymentsService inline to avoid module DI overhead in integration tests.
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const driver = new FilesystemStorageDriver(
      path.join(os.tmpdir(), `sk-test-${runId}`),
      { baseUrl: "http://localhost:4000/api/v1", secret: "test-secret" },
    );
    const storage = new StorageService(driver);
    const svc = new PaymentsService(storage, null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("full");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 150_000_00); // ₦150,000

    const payment = await svc.recordManual(
      ctx(schoolId, ownerId),
      { invoiceId, amount: 150_000_00, method: "CASH", paidAt: new Date().toISOString() },
      reqCtx,
    );

    expect(payment.status).toBe("SUCCESS");
    expect(payment.amount).toBe(150_000_00);
    expect(payment.receiptNumber).toMatch(/^RCP\/\d{4}\/000001$/);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(invoice.status).toBe("PAID");
    expect(invoice.totalPaid).toBe(150_000_00);
  });

  it("two partial payments → ISSUED → PARTIALLY_PAID → PAID", async () => {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const driver = new FilesystemStorageDriver(
      path.join(os.tmpdir(), `sk-test-${runId}-b`),
      { baseUrl: "http://localhost:4000/api/v1", secret: "test-secret" },
    );
    const storage = new StorageService(driver);
    const svc = new PaymentsService(storage, null as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool("partial");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00); // ₦100,000

    await svc.recordManual(
      ctx(schoolId, ownerId),
      { invoiceId, amount: 50_000_00, method: "BANK_TRANSFER", paidAt: new Date().toISOString(), reference: "TRF001" },
      reqCtx,
    );

    const mid = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(mid.status).toBe("PARTIALLY_PAID");
    expect(mid.totalPaid).toBe(50_000_00);

    await svc.recordManual(
      ctx(schoolId, ownerId),
      { invoiceId, amount: 50_000_00, method: "CASH", paidAt: new Date().toISOString() },
      reqCtx,
    );

    const final = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(final.status).toBe("PAID");
    expect(final.totalPaid).toBe(100_000_00);
  });

  it("rejects payment on CANCELLED invoice", async () => {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const svc = new PaymentsService(
      new StorageService(
        new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-c`), {
          baseUrl: "http://localhost:4000/api/v1",
          secret: "test-secret",
        }),
      ),
      null as never,
      new PaymentPlanService(),
    );

    const { schoolId, ownerId } = await makeSchool("cancelled");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 50_000_00);

    // Cancel the invoice directly.
    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED" } }),
    );

    await expect(
      svc.recordManual(
        ctx(schoolId, ownerId),
        { invoiceId, amount: 50_000_00, method: "CASH", paidAt: new Date().toISOString() },
        reqCtx,
      ),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_PAYABLE" });
  });

  it("rejects overpayment (D1 — PAYMENT_WOULD_EXCEED_BALANCE)", async () => {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const svc = new PaymentsService(
      new StorageService(
        new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-d`), {
          baseUrl: "http://localhost:4000/api/v1",
          secret: "test-secret",
        }),
      ),
      null as never,
      new PaymentPlanService(),
    );

    const { schoolId, ownerId } = await makeSchool("overpay");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 10_000_00); // ₦10,000

    await expect(
      svc.recordManual(
        ctx(schoolId, ownerId),
        { invoiceId, amount: 15_000_00, method: "CASH", paidAt: new Date().toISOString() },
        reqCtx,
      ),
    ).rejects.toMatchObject({ code: "PAYMENT_WOULD_EXCEED_BALANCE" });

    // Invoice must remain untouched.
    const inv = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(inv.status).toBe("ISSUED");
    expect(inv.totalPaid).toBe(0);
  });

  it("rejects amount = 0 (Zod validation)", () => {
    const result = recordManualPaymentSchema.safeParse({
      invoiceId: "00000000-0000-0000-0000-000000000001",
      amount: 0,
      method: "CASH",
      paidAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("findAll paginates by invoiceId", async () => {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const svc = new PaymentsService(
      new StorageService(
        new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-e`), {
          baseUrl: "http://localhost:4000/api/v1",
          secret: "test-secret",
        }),
      ),
      null as never,
      new PaymentPlanService(),
    );

    const { schoolId, ownerId } = await makeSchool("list");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 30_000_00); // ₦30,000

    await svc.recordManual(ctx(schoolId, ownerId), { invoiceId, amount: 10_000_00, method: "POS", paidAt: new Date().toISOString() }, reqCtx);
    await svc.recordManual(ctx(schoolId, ownerId), { invoiceId, amount: 10_000_00, method: "CASH", paidAt: new Date().toISOString() }, reqCtx);

    const page1 = await svc.findAll(ctx(schoolId, ownerId), { invoiceId, page: 1, limit: 1 });
    expect(page1.total).toBe(2);
    expect(page1.data).toHaveLength(1);

    const page2 = await svc.findAll(ctx(schoolId, ownerId), { invoiceId, page: 2, limit: 1 });
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0].id).not.toBe(page1.data[0].id);
  });

  it("audit log row written for each recordManual call", async () => {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const svc = new PaymentsService(
      new StorageService(
        new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-f`), {
          baseUrl: "http://localhost:4000/api/v1",
          secret: "test-secret",
        }),
      ),
      null as never,
      new PaymentPlanService(),
    );

    const { schoolId, ownerId } = await makeSchool("audit");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 50_000_00);

    const payment = await svc.recordManual(
      ctx(schoolId, ownerId),
      { invoiceId, amount: 50_000_00, method: "CASH", paidAt: new Date().toISOString() },
      reqCtx,
    );

    const log = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({
        where: { schoolId, action: "payment.record", entityId: payment.id },
        select: { action: true, entityType: true, entityId: true },
      }),
    );
    expect(log).not.toBeNull();
    expect(log?.action).toBe("payment.record");
    expect(log?.entityType).toBe("payment");
    expect(log?.entityId).toBe(payment.id);
  });

  // ── D37: idempotency key ─────────────────────────────────────────────────
  // Real Postgres, real unique index. The race test is the one that matters:
  // the lookup can be passed by two requests at once, and only the index
  // makes the answer "one payment".

  async function idemSvc(tag: string) {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    return new PaymentsService(
      new StorageService(
        new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-${tag}`), {
          baseUrl: "http://localhost:4000/api/v1",
          secret: "test-secret",
        }),
      ),
      null as never,
      new PaymentPlanService(),
    );
  }

  async function paymentState(schoolId: string, invoiceId: string) {
    return withTenant(schoolId, async (db) => ({
      payments: await db.payment.count({ where: { invoiceId } }),
      audits: await db.auditLog.count({ where: { entityType: "payment", action: "payment.record" } }),
      invoice: await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    }));
  }

  it("D37: the same key twice records ONE payment, one audit row, and replays the first", async () => {
    const svc = await idemSvc("idem-a");
    const { schoolId, ownerId } = await makeSchool("idem-a");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const key = randomUUID();
    const input = { invoiceId, amount: 50_000_00, method: "CASH" as const, paidAt: "2026-09-21T09:00:00.000Z", idempotencyKey: key };

    const first = await svc.recordManual(ctx(schoolId, ownerId), input, reqCtx);
    const again = await svc.recordManual(ctx(schoolId, ownerId), input, reqCtx);

    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.receiptNumber).toBe(first.receiptNumber);
    const state = await paymentState(schoolId, invoiceId);
    expect(state.payments).toBe(1);
    expect(state.audits).toBe(1);
    expect(state.invoice).toEqual({ totalPaid: 50_000_00, status: "PARTIALLY_PAID" });
  });

  it("D37: CONCURRENT requests with the same key record one payment — the index, not the lookup, decides", async () => {
    const svc = await idemSvc("idem-race");
    const { schoolId, ownerId } = await makeSchool("idem-race");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const input = { invoiceId, amount: 20_000_00, method: "POS" as const, paidAt: "2026-09-21T09:00:00.000Z", idempotencyKey: randomUUID() };

    const results = await Promise.all(
      Array.from({ length: 4 }, () => svc.recordManual(ctx(schoolId, ownerId), input, reqCtx)),
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const state = await paymentState(schoolId, invoiceId);
    expect(state.payments).toBe(1);
    expect(state.audits).toBe(1);
    expect(state.invoice.totalPaid).toBe(20_000_00);
  });

  it("D37: different keys are different payments — instalments of the same amount are legitimate", async () => {
    const svc = await idemSvc("idem-b");
    const { schoolId, ownerId } = await makeSchool("idem-b");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const base = { invoiceId, amount: 5_000_00, method: "CASH" as const, paidAt: "2026-09-21T09:00:00.000Z" };

    await svc.recordManual(ctx(schoolId, ownerId), { ...base, idempotencyKey: randomUUID() }, reqCtx);
    await svc.recordManual(ctx(schoolId, ownerId), { ...base, idempotencyKey: randomUUID() }, reqCtx);
    // And no key at all — the website's path — is unchanged.
    await svc.recordManual(ctx(schoolId, ownerId), base, reqCtx);

    const state = await paymentState(schoolId, invoiceId);
    expect(state.payments).toBe(3);
    expect(state.invoice.totalPaid).toBe(15_000_00);
  });

  it("D37: a key reused for a DIFFERENT payment is refused, and nothing is recorded", async () => {
    const svc = await idemSvc("idem-c");
    const { schoolId, ownerId } = await makeSchool("idem-c");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const key = randomUUID();
    const input = { invoiceId, amount: 10_000_00, method: "CASH" as const, paidAt: "2026-09-21T09:00:00.000Z", idempotencyKey: key };
    await svc.recordManual(ctx(schoolId, ownerId), input, reqCtx);

    await expect(
      svc.recordManual(ctx(schoolId, ownerId), { ...input, amount: 20_000_00 }, reqCtx),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      svc.recordManual(ctx(schoolId, ownerId), { ...input, method: "BANK_TRANSFER" }, reqCtx),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const state = await paymentState(schoolId, invoiceId);
    expect(state.payments).toBe(1);
    expect(state.invoice.totalPaid).toBe(10_000_00);
  });

  it("D37: keys are per school — another school's key never collides or replays", async () => {
    const svc = await idemSvc("idem-d");
    const a = await makeSchool("idem-da");
    const b = await makeSchool("idem-db");
    const invoiceA = await makeIssuedInvoice(a.schoolId, a.ownerId, 50_000_00);
    const invoiceB = await makeIssuedInvoice(b.schoolId, b.ownerId, 50_000_00);
    const key = randomUUID();

    const payA = await svc.recordManual(ctx(a.schoolId, a.ownerId), { invoiceId: invoiceA, amount: 1_000_00, method: "CASH", paidAt: "2026-09-21T09:00:00.000Z", idempotencyKey: key }, reqCtx);
    const payB = await svc.recordManual(ctx(b.schoolId, b.ownerId), { invoiceId: invoiceB, amount: 1_000_00, method: "CASH", paidAt: "2026-09-21T09:00:00.000Z", idempotencyKey: key }, reqCtx);

    expect(payB.replayed).toBe(false);
    expect(payB.id).not.toBe(payA.id);
    expect(payB.schoolId).toBe(b.schoolId);
  });

  it("D37: the schema accepts a UUID key and refuses anything else", () => {
    const base = { invoiceId: randomUUID(), amount: 100, method: "CASH", paidAt: "2026-09-21T09:00:00.000Z" };
    expect(recordManualPaymentSchema.safeParse({ ...base, idempotencyKey: randomUUID() }).success).toBe(true);
    expect(recordManualPaymentSchema.safeParse({ ...base, idempotencyKey: "tap-1" }).success).toBe(false);
    expect(recordManualPaymentSchema.safeParse(base).success).toBe(true);
  });

  // ── Branded receipts (docs/modules/branded-receipts.md) ──────────────────

  async function receiptSvc(tag: string, opts: { failPutOnce?: boolean } = {}) {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const driver = new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-test-${runId}-${tag}`), {
      baseUrl: "http://localhost:4000/api/v1",
      secret: "test-secret",
    });
    let failNext = opts.failPutOnce ?? false;
    const storage = new StorageService(driver);
    const realPut = storage.put.bind(storage);
    storage.put = ((...args: Parameters<typeof storage.put>) => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error("storage unavailable"));
      }
      return realPut(...args);
    }) as typeof storage.put;
    return { svc: new PaymentsService(storage, null as never, new PaymentPlanService()), storage };
  }

  const pay = (invoiceId: string, amount: number) => ({
    invoiceId,
    amount,
    method: "CASH" as const,
    paidAt: "2026-09-22T09:00:00.000Z",
  });

  async function makeTeacherUser(schoolId: string): Promise<string> {
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: { schoolId, email: `rcpt-teacher-${runId}-${Math.random().toString(36).slice(2, 6)}@example.test`, firstName: "Tunde", lastName: "Teacher" },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
      return user.id;
    });
  }

  it("receipts: the stored receipt is branded — school, student, figures, words, balance, recorder", async () => {
    const { svc, storage } = await receiptSvc("rcpt-content");
    const { schoolId, ownerId } = await makeSchool("rcpt-content");
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { address: "12 Awolowo Road, Ikeja", phone: "08031234567", motto: "Light and Truth" },
    });
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 150_000_00);

    const payment = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 50_000_00), reqCtx);
    const html = (await storage.get(schoolId, { kind: "payment-receipt", paymentId: payment.id })).toString("utf8");

    expect(payment.receiptNumber).toBe("RCP/2026/000001");
    expect(html).toContain(`Pay rcpt-content ${runId}`);
    expect(html).toContain("12 Awolowo Road, Ikeja");
    expect(html).toContain("Light and Truth");
    expect(html).toContain("Test Student");
    expect(html).toContain("First Term 2025/2026-pay-");
    expect(html).toContain("Fifty thousand naira only");
    expect(html).toContain("Balance<b>₦100,000.00</b>");
    expect(html).toContain("Received by: Chidi Admin");
    expect(html).toContain("22 September 2026, 10:00");
  });

  it("receipts: numbers run 1, 2, 3 per school, and each school has its own sequence", async () => {
    const { svc } = await receiptSvc("rcpt-seq");
    const a = await makeSchool("rcpt-seq-a");
    const b = await makeSchool("rcpt-seq-b");
    const invA = await makeIssuedInvoice(a.schoolId, a.ownerId, 100_000_00);
    const invB = await makeIssuedInvoice(b.schoolId, b.ownerId, 100_000_00);

    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      numbers.push((await svc.recordManual(ctx(a.schoolId, a.ownerId), pay(invA, 1_000_00), reqCtx)).receiptNumber as string);
    }
    const first = await svc.recordManual(ctx(b.schoolId, b.ownerId), pay(invB, 1_000_00), reqCtx);

    expect(numbers).toEqual(["RCP/2026/000001", "RCP/2026/000002", "RCP/2026/000003"]);
    expect(first.receiptNumber).toBe("RCP/2026/000001");
  });

  it("receipts: CONCURRENT payments draw distinct, gap-free numbers", async () => {
    const { svc } = await receiptSvc("rcpt-race");
    const { schoolId, ownerId } = await makeSchool("rcpt-race");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx)),
    );
    const numbers = results.map((r) => r.receiptNumber).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `RCP/2026/00000${n}`));
  });

  it("receipts: a receipt failure NEVER refuses the payment, burns no number, and can be re-issued", async () => {
    const { svc } = await receiptSvc("rcpt-rollback", { failPutOnce: true });
    const { schoolId, ownerId } = await makeSchool("rcpt-rollback");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);

    // Storage is down for the first receipt: the cash is still recorded.
    const first = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx);
    expect(first.status).toBe("SUCCESS");
    expect(first.receiptNumber).toBeNull();

    // The failed receipt returned its number: the next receipt is still 1.
    const second = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx);
    expect(second.receiptNumber).toBe("RCP/2026/000001");

    // And the first payment's receipt can be issued afterwards.
    const reissued = await svc.reissueReceipt(ctx(schoolId, ownerId), first.id, reqCtx);
    expect(reissued.receiptNumber).toBe("RCP/2026/000002");
    const state = await withTenant(schoolId, async (db) => ({
      payments: await db.payment.count({ where: { invoiceId } }),
      totalPaid: (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).totalPaid,
    }));
    expect(state).toEqual({ payments: 2, totalPaid: 2_000_00 });
  });

  it("receipts: concurrent issuers for one payment produce ONE receipt, not two numbers", async () => {
    // The first receipt fails, so the payment exists WITHOUT one — the state
    // the webhook and the verify-poll both find when they race.
    const { svc } = await receiptSvc("rcpt-once", { failPutOnce: true });
    const { schoolId, ownerId } = await makeSchool("rcpt-once");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const payment = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx);
    expect(payment.receiptNumber).toBeNull();
    // Simulate the webhook and the verify-poll racing to issue the same receipt.
    const issue = (svc as unknown as { tryIssueReceipt: (s: string, p: string) => Promise<{ receiptNumber: string } | null> })
      .tryIssueReceipt.bind(svc);
    const results = await Promise.all([issue(schoolId, payment.id), issue(schoolId, payment.id), issue(schoolId, payment.id)]);
    expect(new Set(results.map((r) => r?.receiptNumber))).toEqual(new Set(["RCP/2026/000001"]));
    const next = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx);
    expect(next.receiptNumber).toBe("RCP/2026/000002");
  });

  it("receipts: re-issue keeps the number, uses the current branding, and is audited", async () => {
    const { svc, storage } = await receiptSvc("rcpt-reissue");
    const { schoolId, ownerId } = await makeSchool("rcpt-reissue");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 100_000_00);
    const first = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 40_000_00), reqCtx);
    await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 10_000_00), reqCtx);

    await basePrisma.school.update({ where: { id: schoolId }, data: { address: "New Campus, Lekki" } });
    const result = await svc.reissueReceipt(ctx(schoolId, ownerId), first.id, reqCtx);
    const html = (await storage.get(schoolId, { kind: "payment-receipt", paymentId: first.id })).toString("utf8");

    expect(result.receiptNumber).toBe(first.receiptNumber);
    expect(html).toContain("New Campus, Lekki");
    // The balance as it stood at THIS payment, not after the later one.
    expect(html).toContain("Balance<b>₦60,000.00</b>");
    const audits = await withTenant(schoolId, (db) =>
      db.auditLog.count({ where: { action: "payment.receipt-reissue", entityId: first.id } }),
    );
    expect(audits).toBe(1);
    // Re-issue drew no new number.
    const next = await svc.recordManual(ctx(schoolId, ownerId), pay(invoiceId, 1_000_00), reqCtx);
    expect(next.receiptNumber).toBe("RCP/2026/000003");
  });

  it("receipts: only owner, admin or bursar — a teacher is refused, and another school's payment is not found", async () => {
    const { svc } = await receiptSvc("rcpt-gate");
    const a = await makeSchool("rcpt-gate-a");
    const b = await makeSchool("rcpt-gate-b");
    const invoiceId = await makeIssuedInvoice(a.schoolId, a.ownerId, 100_000_00);
    const payment = await svc.recordManual(ctx(a.schoolId, a.ownerId), pay(invoiceId, 1_000_00), reqCtx);
    const teacherId = await makeTeacherUser(a.schoolId);

    await expect(svc.getReceiptUrl(ctx(a.schoolId, teacherId), payment.id)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(svc.reissueReceipt(ctx(a.schoolId, teacherId), payment.id, reqCtx)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(svc.listReceipts(ctx(a.schoolId, teacherId), { page: 1, limit: 30 })).rejects.toMatchObject({ httpStatus: 403 });
    await expect(svc.reissueReceipt(ctx(b.schoolId, b.ownerId), payment.id, reqCtx)).rejects.toMatchObject({ httpStatus: 404 });
  });

  it("receipts: an online payment with NO receipt (payment-link path, before the fix) can be re-issued", async () => {
    const { svc, storage } = await receiptSvc("rcpt-online");
    const { schoolId, ownerId } = await makeSchool("rcpt-online");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 20_000);
    const paymentId = await withTenant(schoolId, async (db) => {
      const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
      const p = await db.payment.create({
        data: {
          schoolId, invoiceId, studentId: invoice.studentId, amount: 20_000, method: "PAYSTACK", status: "SUCCESS",
          paystackReference: `ref-${runId}`, paystackData: { status: "success" }, recordedBy: ownerId, paidAt: new Date("2026-09-22T10:52:00.000Z"),
        },
      });
      await db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 20_000, status: "PAID" } });
      return p.id;
    });

    const result = await svc.reissueReceipt(ctx(schoolId, ownerId), paymentId, reqCtx);
    const html = (await storage.get(schoolId, { kind: "payment-receipt", paymentId })).toString("utf8");

    expect(result.receiptNumber).toBe("RCP/2026/000001");
    expect(html).toContain("Received by: Paid online (Paystack)");
    expect(html).toContain("Balance<b>₦0.00</b>");
    const url = await svc.getReceiptUrl(ctx(schoolId, ownerId), paymentId);
    expect(url.url).toBeTruthy();
  });

  it("receipts: the list is newest first, searchable by name, and scoped to the school", async () => {
    const { svc } = await receiptSvc("rcpt-list");
    const a = await makeSchool("rcpt-list-a");
    const b = await makeSchool("rcpt-list-b");
    const invA = await makeIssuedInvoice(a.schoolId, a.ownerId, 100_000_00);
    const invB = await makeIssuedInvoice(b.schoolId, b.ownerId, 100_000_00);
    await svc.recordManual(ctx(a.schoolId, a.ownerId), { ...pay(invA, 1_000_00), paidAt: "2026-09-20T09:00:00.000Z" }, reqCtx);
    await svc.recordManual(ctx(a.schoolId, a.ownerId), { ...pay(invA, 2_000_00), paidAt: "2026-09-21T09:00:00.000Z" }, reqCtx);
    await svc.recordManual(ctx(b.schoolId, b.ownerId), pay(invB, 3_000_00), reqCtx);

    const list = await svc.listReceipts(ctx(a.schoolId, a.ownerId), { page: 1, limit: 30 });
    expect(list.data.map((r) => r.amount)).toEqual([2_000_00, 1_000_00]);
    expect(list.data[0]).toMatchObject({ studentName: "Test Student", receiptNumber: "RCP/2026/000002" });
    expect(list.hasMore).toBe(false);

    const found = await svc.listReceipts(ctx(a.schoolId, a.ownerId), { search: "test", page: 1, limit: 30 });
    expect(found.data).toHaveLength(2);
    const none = await svc.listReceipts(ctx(a.schoolId, a.ownerId), { search: "nobody-by-this-name", page: 1, limit: 30 });
    expect(none.data).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 — parsePaystackReference (pure unit — no DB)
// ─────────────────────────────────────────────────────────────────────────────

describe("parsePaystackReference", () => {
  const schoolId = "550e8400-e29b-41d4-a716-446655440000";
  const paymentId = "660f9511-f3ac-52e5-b827-557766551111";

  it("parses a well-formed reference", () => {
    const ref = `PSK-${schoolId}-${paymentId}`;
    const result = parsePaystackReference(ref);
    expect(result).toEqual({ schoolId, paymentId });
  });

  it("returns null for a string without the PSK- prefix", () => {
    expect(parsePaystackReference(`${schoolId}-${paymentId}`)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parsePaystackReference("")).toBeNull();
  });

  it("returns null when the schoolId portion is not a valid UUID", () => {
    expect(parsePaystackReference(`PSK-not-a-uuid-${paymentId}`)).toBeNull();
  });

  it("returns null when the paymentId portion is not a valid UUID", () => {
    expect(parsePaystackReference(`PSK-${schoolId}-not-a-uuid`)).toBeNull();
  });

  it("returns null for a truncated reference", () => {
    expect(parsePaystackReference(`PSK-${schoolId}`)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4 — PaymentsService Paystack methods (integration tests — real DB)
// ─────────────────────────────────────────────────────────────────────────────

// Stub PaystackService so integration tests don't hit the real Paystack API.
// Overrides allow individual tests to simulate failures or vary the verify result.
function makePaystackStub(overrides: {
  initializeTransaction?: (...args: unknown[]) => Promise<unknown>;
  verifyTransaction?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    initializeTransaction: overrides.initializeTransaction ?? (async ({ reference }: { reference: string }) => ({
      authorization_url: `https://checkout.paystack.com/${reference}`,
      access_code: `ac_${reference}`,
      reference,
    })),
    verifyTransaction: overrides.verifyTransaction ?? (async (reference: string) => ({
      status: "success",
      reference,
      amount: 50_000_00,
      paid_at: new Date().toISOString(),
      metadata: null,
      channel: "card",
      currency: "NGN",
      fees: 0,
      customer: { email: "guardian@example.test" },
    })),
    verifyWebhookSignature: () => true,
  };
}

describe("PaymentsService — Paystack methods (integration)", () => {
  const runId2 = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds2 = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds2) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
  });

  // Every school defaults to manual-only (paystackPaymentsEnabled: false —
  // see the compressed plan-first, 2026-07-31). This describe block tests
  // the Paystack flow itself, so its fixture pre-configures a subaccount and
  // enables it directly via basePrisma (bypassing the real save-time
  // getSubaccount verification, which is SchoolsService's concern, not
  // this one) — the gate itself is tested separately below with
  // makeSchool2WithoutPaystack.
  async function makeSchool2(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `PSK ${suffix} ${runId2}`,
        schoolSlug: `psk-${suffix}-${runId2}`,
        ownerFirstName: "Amaka",
        ownerLastName: "Boss",
        ownerEmail: `psk-${suffix}-${runId2}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds2.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: {
        status: "ACTIVE",
        onboardingStep: 5,
        paystackPaymentsEnabled: true,
        paystackSubaccountCode: `ACCT_test_${suffix}_${runId2}`,
      },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  // Manual-only school (the real default) — used to test the new server-side
  // gate that blocks initPaystack when Paystack hasn't been enabled.
  async function makeSchool2WithoutPaystack(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `PSK-manual ${suffix} ${runId2}`,
        schoolSlug: `psk-manual-${suffix}-${runId2}`,
        ownerFirstName: "Amaka",
        ownerLastName: "Boss",
        ownerEmail: `psk-manual-${suffix}-${runId2}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds2.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  async function makeIssuedInvoice2(
    schoolId: string,
    ownerId: string,
    totalDue: number,
    suffix: string,
  ): Promise<{ invoiceId: string; studentId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-psk-${suffix}-${runId2}`,
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
          admissionNumber: `ADM-PSK-${suffix}-${runId2}`,
          firstName: "Tunde",
          lastName: "Obi",
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
          status: "ISSUED",
          items: [],
          totalAmount: totalDue,
          totalDiscount: 0,
          totalDue,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      return { invoiceId: invoice.id, studentId: student.id };
    });
  }

  async function makeSvcWithStorage(suffix: string) {
    const { PaymentsService } = await import("./payments.service.js");
    const { StorageService } = await import("../../common/storage/storage.service.js");
    const { FilesystemStorageDriver } = await import("../../common/storage/filesystem-storage.driver.js");
    const os = await import("node:os");
    const path = await import("node:path");
    const storage = new StorageService(
      new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-psk-${suffix}-${runId2}`), {
        baseUrl: "http://localhost:4000/api/v1",
        secret: "test-secret",
      }),
    );
    return { PaymentsService, storage };
  }

  // ── initPaystack ──────────────────────────────────────────────────────────

  it("initPaystack: happy path → creates PENDING row, returns authorizationUrl + reference + paymentId", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("init-happy");
    const initSpy = vi.fn(async ({ reference }: { reference: string }) => ({
      authorization_url: `https://checkout.paystack.com/${reference}`,
      access_code: `ac_${reference}`,
      reference,
    }));
    const stub = makePaystackStub({ initializeTransaction: initSpy });
    const svc = new PaymentsService(storage, stub as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("init-happy");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "ih");

    const result = await svc.initPaystack(ctx(schoolId, ownerId), { invoiceId, amount: 50_000_00 });

    expect(result.authorizationUrl).toContain("checkout.paystack.com");
    expect(result.reference).toMatch(/^PSK-[0-9a-f-]{36}-[0-9a-f-]{36}$/);
    expect(result.paymentId).toBeTruthy();

    // Payment row should be PENDING with the reference set.
    const payment = await withTenant(schoolId, (db) =>
      db.payment.findUniqueOrThrow({
        where: { id: result.paymentId },
        select: { status: true, method: true, paystackReference: true },
      }),
    );
    expect(payment.status).toBe("PENDING");
    expect(payment.method).toBe("PAYSTACK");
    expect(payment.paystackReference).toBe(result.reference);

    // Subaccount routing (compressed plan-first, 2026-07-31): the school's
    // subaccount code must be passed through to Paystack on every call.
    expect(initSpy).toHaveBeenCalledWith(
      expect.objectContaining({ subaccount: `ACCT_test_init-happy_${runId2}` }),
    );
  });

  it("initPaystack: rejects when Paystack is not enabled for the school (manual-only default)", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("init-disabled");
    const initSpy = vi.fn();
    const svc = new PaymentsService(storage, makePaystackStub({ initializeTransaction: initSpy }) as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2WithoutPaystack("init-disabled");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "idis");

    await expect(
      svc.initPaystack(ctx(schoolId, ownerId), { invoiceId, amount: 50_000_00 }),
    ).rejects.toMatchObject({ code: "PAYSTACK_NOT_ENABLED" });

    // Must reject BEFORE ever calling Paystack, and without leaving a
    // dangling PENDING payment row behind.
    expect(initSpy).not.toHaveBeenCalled();
    const rows = await withTenant(schoolId, (db) =>
      db.payment.findMany({ where: { invoiceId }, select: { id: true } }),
    );
    expect(rows).toHaveLength(0);
  });

  it("initPaystack: rejects payment on CANCELLED invoice", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("init-cancelled");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("init-cancelled");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "ic");

    await withTenant(schoolId, (db) =>
      db.invoice.update({ where: { id: invoiceId }, data: { status: "CANCELLED" } }),
    );

    await expect(
      svc.initPaystack(ctx(schoolId, ownerId), { invoiceId, amount: 50_000_00 }),
    ).rejects.toMatchObject({ code: "INVOICE_NOT_PAYABLE" });
  });

  it("initPaystack: rejects overpayment", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("init-overpay");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("init-overpay");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 20_000_00, "io");

    await expect(
      svc.initPaystack(ctx(schoolId, ownerId), { invoiceId, amount: 99_999_00 }),
    ).rejects.toMatchObject({ code: "PAYMENT_WOULD_EXCEED_BALANCE" });
  });

  it("initPaystack: marks payment FAILED if Paystack API throws, then re-throws", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("init-apifail");
    const stub = makePaystackStub({
      initializeTransaction: async () => { throw new Error("Paystack API down"); },
    });
    const svc = new PaymentsService(storage, stub as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("init-apifail");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 30_000_00, "iaf");

    await expect(
      svc.initPaystack(ctx(schoolId, ownerId), { invoiceId, amount: 30_000_00 }),
    ).rejects.toThrow("Paystack API down");

    // There should be a FAILED payment row (the PENDING row was updated to FAILED).
    const rows = await withTenant(schoolId, (db) =>
      db.payment.findMany({ where: { invoiceId, method: "PAYSTACK" }, select: { status: true } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FAILED");
  });

  // ── handleWebhook ─────────────────────────────────────────────────────────

  it("handleWebhook charge.success: PENDING → SUCCESS, invoice totalPaid updated, receipt generated", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("webhook-success");
    const stub = makePaystackStub();
    const svc = new PaymentsService(storage, stub as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("webhook-success");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "ws");

    // Create a PENDING Paystack payment directly.
    const { paymentId, paystackReference } = await withTenant(schoolId, async (db) => {
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId: (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { studentId: true } })).studentId,
          amount: 50_000_00,
          method: "PAYSTACK",
          status: "PENDING",
          recordedBy: ownerId,
        },
        select: { id: true },
      });
      const ref = `PSK-${schoolId}-${p.id}`;
      await db.payment.update({ where: { id: p.id }, data: { paystackReference: ref } });
      return { paymentId: p.id, paystackReference: ref };
    });

    await svc.handleWebhook({
      event: "charge.success",
      data: { reference: paystackReference, status: "success", amount: 50_000_00, paid_at: new Date().toISOString() },
    });

    const payment = await withTenant(schoolId, (db) =>
      db.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, receiptNumber: true, receiptUrl: true },
      }),
    );
    expect(payment.status).toBe("SUCCESS");
    expect(payment.receiptNumber).toMatch(/^RCP\/\d{4}\/000001$/);
    expect(payment.receiptUrl).toBeTruthy();

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(invoice.status).toBe("PAID");
    expect(invoice.totalPaid).toBe(50_000_00);

    // Audit log should be written.
    const log = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({ where: { schoolId, action: "payment.paystack-confirm", entityId: paymentId } }),
    );
    expect(log).not.toBeNull();
  });

  it("handleWebhook charge.failed: PENDING → FAILED, invoice totalPaid unchanged", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("webhook-failed");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("webhook-failed");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "wf");

    const { paymentId, paystackReference } = await withTenant(schoolId, async (db) => {
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId: (await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { studentId: true } })).studentId,
          amount: 50_000_00,
          method: "PAYSTACK",
          status: "PENDING",
          recordedBy: ownerId,
        },
        select: { id: true },
      });
      const ref = `PSK-${schoolId}-${p.id}`;
      await db.payment.update({ where: { id: p.id }, data: { paystackReference: ref } });
      return { paymentId: p.id, paystackReference: ref };
    });

    await svc.handleWebhook({
      event: "charge.failed",
      data: { reference: paystackReference, status: "failed", amount: 50_000_00, paid_at: null },
    });

    const payment = await withTenant(schoolId, (db) =>
      db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { status: true } }),
    );
    expect(payment.status).toBe("FAILED");

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true, status: true } }),
    );
    expect(invoice.totalPaid).toBe(0);
    expect(invoice.status).toBe("ISSUED");
  });

  it("handleWebhook charge.success: idempotent — already SUCCESS → no double-credit", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("webhook-idem");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("webhook-idem");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "wi");

    // Create an already-SUCCESS payment.
    const { paystackReference } = await withTenant(schoolId, async (db) => {
      const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { studentId: true } });
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId: inv.studentId,
          amount: 50_000_00,
          method: "PAYSTACK",
          status: "SUCCESS",
          recordedBy: ownerId,
          paidAt: new Date(),
        },
        select: { id: true },
      });
      const ref = `PSK-${schoolId}-${p.id}`;
      await db.payment.update({ where: { id: p.id }, data: { paystackReference: ref } });
      await db.invoice.update({ where: { id: invoiceId }, data: { totalPaid: 50_000_00, status: "PAID" } });
      return { paystackReference: ref };
    });

    // Send the webhook again.
    await svc.handleWebhook({
      event: "charge.success",
      data: { reference: paystackReference, status: "success", amount: 50_000_00, paid_at: new Date().toISOString() },
    });

    // totalPaid must still be 50_000_00, not doubled.
    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { totalPaid: true } }),
    );
    expect(invoice.totalPaid).toBe(50_000_00);
  });

  it("handleWebhook: unknown event type → no-op (no DB writes)", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("webhook-unknown");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    // Should not throw and should not touch the DB.
    await expect(
      svc.handleWebhook({
        event: "transfer.success",
        data: { reference: "PSK-anything", status: "success", amount: 0, paid_at: null },
      }),
    ).resolves.toBeUndefined();
  });

  it("handleWebhook: unrecognized reference format → no-op", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("webhook-badref");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    await expect(
      svc.handleWebhook({
        event: "charge.success",
        data: { reference: "TXN_12345", status: "success", amount: 0, paid_at: null },
      }),
    ).resolves.toBeUndefined();
  });

  // ── verifyPaystack ────────────────────────────────────────────────────────

  it("verifyPaystack: PENDING → SUCCESS when Paystack returns success", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("verify-success");
    const stub = makePaystackStub();
    const svc = new PaymentsService(storage, stub as never, new PaymentPlanService());

    const { schoolId, ownerId } = await makeSchool2("verify-success");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 40_000_00, "vs");

    const { paymentId, paystackReference } = await withTenant(schoolId, async (db) => {
      const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { studentId: true } });
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId: inv.studentId,
          amount: 40_000_00,
          method: "PAYSTACK",
          status: "PENDING",
          recordedBy: ownerId,
        },
        select: { id: true },
      });
      const ref = `PSK-${schoolId}-${p.id}`;
      await db.payment.update({ where: { id: p.id }, data: { paystackReference: ref } });
      return { paymentId: p.id, paystackReference: ref };
    });

    const result = await svc.verifyPaystack(ctx(schoolId, ownerId), paystackReference);

    expect(result.status).toBe("SUCCESS");
    expect(result.id).toBe(paymentId);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true, totalPaid: true } }),
    );
    expect(invoice.status).toBe("PAID");
    expect(invoice.totalPaid).toBe(40_000_00);
  });

  it("verifyPaystack: already SUCCESS → returns current state without re-applying", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("verify-idem");
    const applySpy = vi.fn();
    const stub = makePaystackStub({
      verifyTransaction: async (ref: string) => ({
        status: "success",
        reference: ref,
        amount: 50_000_00,
        paid_at: new Date().toISOString(),
        metadata: null,
        channel: "card",
        currency: "NGN",
        fees: 0,
        customer: { email: "g@example.test" },
      }),
    });
    const svc = new PaymentsService(storage, stub as never, new PaymentPlanService());
    // Spy on the private helper to ensure it is NOT called when already terminal.
    (svc as unknown as Record<string, unknown>)["applyPaystackSuccess"] = applySpy;

    const { schoolId, ownerId } = await makeSchool2("verify-idem");
    const { invoiceId } = await makeIssuedInvoice2(schoolId, ownerId, 50_000_00, "vi");

    const { paystackReference } = await withTenant(schoolId, async (db) => {
      const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { studentId: true } });
      const p = await db.payment.create({
        data: {
          schoolId,
          invoiceId,
          studentId: inv.studentId,
          amount: 50_000_00,
          method: "PAYSTACK",
          status: "SUCCESS",
          recordedBy: ownerId,
          paidAt: new Date(),
        },
        select: { id: true },
      });
      const ref = `PSK-${schoolId}-${p.id}`;
      await db.payment.update({ where: { id: p.id }, data: { paystackReference: ref } });
      return { paystackReference: ref };
    });

    const result = await svc.verifyPaystack(ctx(schoolId, ownerId), paystackReference);

    expect(result.status).toBe("SUCCESS");
    expect(applySpy).not.toHaveBeenCalled();
  });

  it("verifyPaystack: cross-school guard — schoolId in reference ≠ authCtx.schoolId → NotFoundError", async () => {
    const { PaymentsService, storage } = await makeSvcWithStorage("verify-xschool");
    const svc = new PaymentsService(storage, makePaystackStub() as never, new PaymentPlanService());

    const { schoolId: school1 } = await makeSchool2("verify-xschool-1");
    const { schoolId: school2 } = await makeSchool2("verify-xschool-2");

    // Reference belongs to school1 but we authenticate as school2.
    const fakeRef = `PSK-${school1}-00000000-0000-0000-0000-000000000001`;

    await expect(
      svc.verifyPaystack(ctx(school2, "any-user"), fakeRef),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
