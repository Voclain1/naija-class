import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { recordManualPaymentSchema } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { computeInvoiceStatus } from "./payments.service.js";

// Phase 3 / Slice 7 CP1 — payments service spec.
//
// Part 1 (describe "computeInvoiceStatus"): pure-function unit tests — no DB.
//   Covers: ISSUED / PARTIALLY_PAID / PAID transitions, zero, equal, greater.
//
// Part 2 (describe "PaymentsService"): integration tests — real DB.
//   Covers: recordManual happy paths (single full payment, two partials),
//   rejection of payments on CANCELLED invoice, overpayment rejection,
//   zero-amount rejection, findAll pagination, audit log row written.

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
    const svc = new PaymentsService(storage);

    const { schoolId, ownerId } = await makeSchool("full");
    const invoiceId = await makeIssuedInvoice(schoolId, ownerId, 150_000_00); // ₦150,000

    const payment = await svc.recordManual(
      ctx(schoolId, ownerId),
      { invoiceId, amount: 150_000_00, method: "CASH", paidAt: new Date().toISOString() },
      reqCtx,
    );

    expect(payment.status).toBe("SUCCESS");
    expect(payment.amount).toBe(150_000_00);
    expect(payment.receiptNumber).toMatch(/^RCP-[0-9A-F]{8}$/);

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
    const svc = new PaymentsService(storage);

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
});
