import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import type { InvoiceStatus } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { computeInstallmentsPaid } from "./payment-plan.service.js";

// Phase 3 / Slice 9 — payment plan service spec.
//
// Part 1 (describe "computeInstallmentsPaid"): pure unit tests — no DB.
//   Covers the threshold-based cumulative allocation helper.
//
// Part 2 (describe "PaymentPlanService (integration)"): real DB.
//   Covers: create happy paths (ISSUED, PARTIALLY_PAID), status guards,
//   duplicate plan rejection, sum mismatch, delete + lock, recompute.

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 — computeInstallmentsPaid (pure unit)
// ─────────────────────────────────────────────────────────────────────────────

describe("computeInstallmentsPaid", () => {
  it("totalPaid = 0 → all false", () => {
    expect(computeInstallmentsPaid([50_000, 50_000, 50_000], 0)).toEqual([false, false, false]);
  });

  it("totalPaid = exactly first installment → first true, rest false", () => {
    expect(computeInstallmentsPaid([50_000, 50_000, 50_000], 50_000)).toEqual([true, false, false]);
  });

  it("totalPaid = first + second → first two true", () => {
    expect(computeInstallmentsPaid([50_000, 50_000, 50_000], 100_000)).toEqual([true, true, false]);
  });

  it("totalPaid = all → all true", () => {
    expect(computeInstallmentsPaid([50_000, 50_000, 50_000], 150_000)).toEqual([true, true, true]);
  });

  it("non-round: 80k against [50k, 50k, 50k] → only first paid", () => {
    // cumulative: 50k, 100k, 150k — 80k satisfies only the first threshold
    expect(computeInstallmentsPaid([50_000, 50_000, 50_000], 80_000)).toEqual([true, false, false]);
  });

  it("single installment fully paid", () => {
    expect(computeInstallmentsPaid([100_000], 100_000)).toEqual([true]);
  });

  it("single installment not paid", () => {
    expect(computeInstallmentsPaid([100_000], 0)).toEqual([false]);
  });

  it("empty amounts → empty result", () => {
    expect(computeInstallmentsPaid([], 50_000)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2 — PaymentPlanService integration tests (real DB)
// ─────────────────────────────────────────────────────────────────────────────

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23482${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

describe("PaymentPlanService (integration)", () => {
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
        schoolName: `PP ${suffix} ${runId}`,
        schoolSlug: `pp-${suffix}-${runId}`,
        ownerFirstName: "Amaka",
        ownerLastName: "Admin",
        ownerEmail: `pp-${suffix}-${runId}@example.test`,
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
    opts: { totalDue: number; totalPaid?: number; status?: InvoiceStatus },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-pp-${runId}-${Math.random().toString(36).slice(2, 6)}`,
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
          admissionNumber: `ADM-PP-${runId}-${Math.random().toString(36).slice(2, 6)}`,
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
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      return invoice.id;
    });
  }

  // ── Tests ────────────────────────────────────────────────────────────────

  it("create: happy path on ISSUED invoice", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();

    const { schoolId, ownerId } = await makeSchool("c-issued");
    const invoiceId = await makeInvoice(schoolId, ownerId, { totalDue: 150_000 });

    const plan = await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Three equal installments",
      installments: [
        { amount: 50_000, dueDate: "2026-01-15" },
        { amount: 50_000, dueDate: "2026-02-15" },
        { amount: 50_000, dueDate: "2026-03-15" },
      ],
    });

    expect(plan.invoiceId).toBe(invoiceId);
    expect(plan.name).toBe("Three equal installments");
    expect(plan.installments).toHaveLength(3);
    expect(plan.installments.every((i) => !i.paid)).toBe(true);
  });

  it("create: happy path on PARTIALLY_PAID invoice — first installment auto-marked paid", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();

    const { schoolId, ownerId } = await makeSchool("c-partial");
    // totalPaid = 50k covers first 50k installment
    const invoiceId = await makeInvoice(schoolId, ownerId, {
      totalDue: 150_000,
      totalPaid: 50_000,
      status: "PARTIALLY_PAID",
    });

    const plan = await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Partial plan",
      installments: [
        { amount: 50_000, dueDate: "2026-01-15" },
        { amount: 50_000, dueDate: "2026-02-15" },
        { amount: 50_000, dueDate: "2026-03-15" },
      ],
    });

    expect(plan.installments[0].paid).toBe(true);
    expect(plan.installments[1].paid).toBe(false);
    expect(plan.installments[2].paid).toBe(false);
  });

  it("create: rejects PAID invoice with INVOICE_NOT_PLANNABLE", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();
    const { ConflictError } = await import("@school-kit/types");

    const { schoolId, ownerId } = await makeSchool("c-paid");
    const invoiceId = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        invoiceId,
        name: "Should fail",
        installments: [{ amount: 100_000, dueDate: "2026-01-15" }],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("create: rejects duplicate plan with PLAN_ALREADY_EXISTS", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();
    const { ConflictError } = await import("@school-kit/types");

    const { schoolId, ownerId } = await makeSchool("c-dup");
    const invoiceId = await makeInvoice(schoolId, ownerId, { totalDue: 100_000 });

    await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "First plan",
      installments: [{ amount: 100_000, dueDate: "2026-01-15" }],
    });

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        invoiceId,
        name: "Second plan",
        installments: [{ amount: 100_000, dueDate: "2026-01-15" }],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("create: rejects sum mismatch with INSTALLMENT_SUM_MISMATCH", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();
    const { ConflictError } = await import("@school-kit/types");

    const { schoolId, ownerId } = await makeSchool("c-sum");
    const invoiceId = await makeInvoice(schoolId, ownerId, { totalDue: 100_000 });

    await expect(
      svc.create(ctx(schoolId, ownerId), {
        invoiceId,
        name: "Wrong sum",
        installments: [
          { amount: 40_000, dueDate: "2026-01-15" },
          { amount: 40_000, dueDate: "2026-02-15" },
        ],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("delete: happy path — no payments, plan deleted", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();

    const { schoolId, ownerId } = await makeSchool("d-ok");
    const invoiceId = await makeInvoice(schoolId, ownerId, { totalDue: 100_000 });

    const plan = await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Delete me",
      installments: [{ amount: 100_000, dueDate: "2026-01-15" }],
    });

    await expect(svc.delete(ctx(schoolId, ownerId), plan.id)).resolves.toBeUndefined();

    const refetched = await svc.findByInvoice(ctx(schoolId, ownerId), invoiceId);
    expect(refetched).toBeNull();
  });

  it("delete: locked when totalPaid > 0 → PLAN_LOCKED_PAYMENTS_EXIST", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();
    const { ConflictError } = await import("@school-kit/types");

    const { schoolId, ownerId } = await makeSchool("d-locked");
    const invoiceId = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 50_000,
      status: "PARTIALLY_PAID",
    });

    const plan = await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Locked plan",
      installments: [
        { amount: 50_000, dueDate: "2026-01-15" },
        { amount: 50_000, dueDate: "2026-02-15" },
      ],
    });

    await expect(svc.delete(ctx(schoolId, ownerId), plan.id)).rejects.toThrow(ConflictError);
  });

  it("recomputeInstallmentsPaid: no plan → no-op (does not throw)", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();

    const { schoolId, ownerId } = await makeSchool("r-noop");
    const invoiceId = await makeInvoice(schoolId, ownerId, { totalDue: 100_000 });

    // Call via the DB client directly — no plan created, should be a silent no-op.
    await expect(
      withTenant(schoolId, (db) => svc.recomputeInstallmentsPaid(db as never, invoiceId, 0)),
    ).resolves.toBeUndefined();
  });

  it("recomputeInstallmentsPaid: marks correct installments paid after partial payment", async () => {
    const { PaymentPlanService } = await import("./payment-plan.service.js");
    const svc = new PaymentPlanService();

    const { schoolId, ownerId } = await makeSchool("r-partial");
    const invoiceId = await makeInvoice(schoolId, ownerId, {
      totalDue: 150_000,
      totalPaid: 0,
      status: "ISSUED",
    });

    // Create plan with all installments initially unpaid.
    await svc.create(ctx(schoolId, ownerId), {
      invoiceId,
      name: "Recompute test",
      installments: [
        { amount: 50_000, dueDate: "2026-01-15" },
        { amount: 50_000, dueDate: "2026-02-15" },
        { amount: 50_000, dueDate: "2026-03-15" },
      ],
    });

    // Simulate 100k paid — should mark first two paid.
    await withTenant(schoolId, (db) =>
      svc.recomputeInstallmentsPaid(db as never, invoiceId, 100_000),
    );

    const plan = await svc.findByInvoice(ctx(schoolId, ownerId), invoiceId);
    expect(plan!.installments[0].paid).toBe(true);
    expect(plan!.installments[1].paid).toBe(true);
    expect(plan!.installments[2].paid).toBe(false);
  });
});
