import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, type InvoiceStatus } from "@school-kit/types";

import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "./finance.service.js";

// Phase 3 / Slice 10 — FinanceService integration spec.
// Phase 3 / Slice 14 adds the getDashboard block.
//
// Covers: transitionOverdueInvoices (OVERDUE cron), listDebtors (query +
// sort), sendReminders (skip when no guardian email), and getDashboard
// (collections vs target, debtor totals, expense totals, P&L).
//
// All tests hit a real DB via withTenant. Each test creates its own isolated
// school so there is no cross-test pollution.

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23483${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const YESTERDAY = new Date();
YESTERDAY.setDate(YESTERDAY.getDate() - 1);
YESTERDAY.setHours(0, 0, 0, 0);

const TOMORROW = new Date();
TOMORROW.setDate(TOMORROW.getDate() + 1);
TOMORROW.setHours(0, 0, 0, 0);

describe("FinanceService (integration)", () => {
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
        schoolName: `Fin ${suffix} ${runId}`,
        schoolSlug: `fin-${suffix}-${runId}`,
        ownerFirstName: "Tunde",
        ownerLastName: "Admin",
        ownerEmail: `fin-${suffix}-${runId}@example.test`,
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

  /** Creates an academic year + term + student + invoice and returns { termId, invoiceId, studentId }. */
  async function makeInvoice(
    schoolId: string,
    ownerId: string,
    opts: {
      totalDue: number;
      totalPaid?: number;
      status?: InvoiceStatus;
      dueDate?: Date | null;
    },
  ): Promise<{ termId: string; invoiceId: string; studentId: string }> {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-fin-${runId}-${Math.random().toString(36).slice(2, 6)}`,
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
          admissionNumber: `ADM-FIN-${runId}-${Math.random().toString(36).slice(2, 6)}`,
          firstName: "Test",
          lastName: "Debtor",
          dateOfBirth: new Date("2010-01-01"),
          gender: "FEMALE",
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
      return { termId: term.id, invoiceId: invoice.id, studentId: student.id };
    });
  }

  // ── transitionOverdueInvoices ────────────────────────────────────────────

  it("ISSUED invoice with past dueDate transitions to OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ov-issued");
    const { termId: _termId, invoiceId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      status: "ISSUED",
      dueDate: YESTERDAY,
    });

    await svc.transitionOverdueInvoices([schoolId]);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
    );
    expect(invoice.status).toBe("OVERDUE");
  });

  it("PARTIALLY_PAID invoice with past dueDate transitions to OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ov-partial");
    const { invoiceId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 40_000,
      status: "PARTIALLY_PAID",
      dueDate: YESTERDAY,
    });

    await svc.transitionOverdueInvoices([schoolId]);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
    );
    expect(invoice.status).toBe("OVERDUE");
  });

  it("PAID invoice with past dueDate is NOT transitioned to OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ov-paid");
    const { invoiceId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
      dueDate: YESTERDAY,
    });

    await svc.transitionOverdueInvoices([schoolId]);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
    );
    expect(invoice.status).toBe("PAID");
  });

  it("ISSUED invoice with null dueDate is NOT transitioned to OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ov-nodate");
    const { invoiceId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      status: "ISSUED",
      dueDate: null,
    });

    await svc.transitionOverdueInvoices([schoolId]);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
    );
    expect(invoice.status).toBe("ISSUED");
  });

  it("ISSUED invoice with future dueDate is NOT transitioned to OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ov-future");
    const { invoiceId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      status: "ISSUED",
      dueDate: TOMORROW,
    });

    await svc.transitionOverdueInvoices([schoolId]);

    const invoice = await withTenant(schoolId, (db) =>
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } }),
    );
    expect(invoice.status).toBe("ISSUED");
  });

  // ── listDebtors ──────────────────────────────────────────────────────────

  it("listDebtors returns ISSUED, PARTIALLY_PAID, and OVERDUE invoices for the term", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ld-all");

    // All three in same school → must share the same term.
    const { termId } = await makeInvoice(schoolId, ownerId, { totalDue: 100_000, status: "ISSUED" });
    // Create two more invoices sharing the same term via direct DB writes.
    await withTenant(schoolId, async (db) => {
      const term = await db.term.findUniqueOrThrow({ where: { id: termId }, select: { academicYearId: true } });
      for (const [status, totalPaid] of [
        ["PARTIALLY_PAID", 40_000],
        ["PAID", 80_000],
        ["OVERDUE", 0],
      ] as const) {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM-LD-${status}-${runId}-${Math.random().toString(36).slice(2, 4)}`,
            firstName: "Test",
            lastName: status,
            dateOfBirth: new Date("2010-01-01"),
            gender: "MALE",
          },
          select: { id: true },
        });
        await db.invoice.create({
          data: {
            schoolId,
            studentId: student.id,
            termId,
            academicYearId: term.academicYearId,
            status,
            items: [],
            totalAmount: 80_000,
            totalDiscount: 0,
            totalDue: 80_000,
            totalPaid,
            issuedAt: new Date(),
            issuedBy: ownerId,
          },
        });
      }
    });

    const debtors = await svc.listDebtors(ctx(schoolId, ownerId), termId);

    const statuses = debtors.map((d) => d.status);
    // Must include the three outstanding statuses
    expect(statuses).toContain("ISSUED");
    expect(statuses).toContain("PARTIALLY_PAID");
    expect(statuses).toContain("OVERDUE");
    // Must NOT include PAID
    expect(statuses).not.toContain("PAID");
  });

  it("listDebtors sorts OVERDUE first, PARTIALLY_PAID second, ISSUED third", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ld-sort");

    // Create all invoices in the same term so the sort can be verified.
    const { termId } = await makeInvoice(schoolId, ownerId, { totalDue: 100_000, status: "ISSUED" });
    await withTenant(schoolId, async (db) => {
      const term = await db.term.findUniqueOrThrow({ where: { id: termId }, select: { academicYearId: true } });
      for (const [status, totalPaid] of [
        ["PARTIALLY_PAID", 30_000],
        ["OVERDUE", 0],
      ] as const) {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM-SORT-${status}-${runId}-${Math.random().toString(36).slice(2, 4)}`,
            firstName: "Sort",
            lastName: status,
            dateOfBirth: new Date("2010-01-01"),
            gender: "MALE",
          },
          select: { id: true },
        });
        await db.invoice.create({
          data: {
            schoolId,
            studentId: student.id,
            termId,
            academicYearId: term.academicYearId,
            status,
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid,
            issuedAt: new Date(),
            issuedBy: ownerId,
          },
        });
      }
    });

    const debtors = await svc.listDebtors(ctx(schoolId, ownerId), termId);
    const statuses = debtors.map((d) => d.status);

    // OVERDUE always before PARTIALLY_PAID
    const overdueIdx = statuses.indexOf("OVERDUE");
    const partialIdx = statuses.indexOf("PARTIALLY_PAID");
    const issuedIdx = statuses.indexOf("ISSUED");
    expect(overdueIdx).toBeLessThan(partialIdx);
    expect(partialIdx).toBeLessThan(issuedIdx);
  });

  it("listDebtors computes balance = totalDue − totalPaid server-side", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("ld-balance");
    const { termId, invoiceId: _id } = await makeInvoice(schoolId, ownerId, {
      totalDue: 150_000,
      totalPaid: 50_000,
      status: "PARTIALLY_PAID",
    });

    const debtors = await svc.listDebtors(ctx(schoolId, ownerId), termId);
    expect(debtors).toHaveLength(1);
    expect(debtors[0].balance).toBe(100_000);
    expect(debtors[0].totalDue).toBe(150_000);
    expect(debtors[0].totalPaid).toBe(50_000);
  });

  // ── sendReminders ────────────────────────────────────────────────────────

  it("sendReminders returns skipped=1 when no guardian email is configured (no Resend key needed)", async () => {
    // FinanceService will be constructed without RESEND_API_KEY set in test env —
    // but even if it were, we skip because there's no guardian email to send to.
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("remind");
    const { termId, studentId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      status: "ISSUED",
    });

    // Student has no guardian linked — no email to send.
    const result = await svc.sendReminders(ctx(schoolId, ownerId), {
      termId,
      studentIds: [studentId],
    });

    // Either RESEND_API_KEY not set (sent=0, skipped=1 from the early return)
    // or no guardian email (skipped=1). Both outcomes satisfy the assertion.
    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
  });

  // ── getDashboard ─────────────────────────────────────────────────────────

  /** Adds one more invoice to an already-existing term (student created fresh each time). */
  async function addInvoice(
    schoolId: string,
    ownerId: string,
    termId: string,
    academicYearId: string,
    opts: { totalDue: number; totalPaid?: number; status: InvoiceStatus },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-DASH-${opts.status}-${runId}-${Math.random().toString(36).slice(2, 6)}`,
          firstName: "Dash",
          lastName: opts.status,
          dateOfBirth: new Date("2010-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      const invoice = await db.invoice.create({
        data: {
          schoolId,
          studentId: student.id,
          termId,
          academicYearId,
          status: opts.status,
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

  /** Creates a fresh category + expense (each test gets its own category to avoid name collisions). */
  async function addExpense(
    schoolId: string,
    ownerId: string,
    opts: { amount: number; incurredAt: Date },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const category = await db.expenseCategory.create({
        data: { schoolId, name: `Dash-Cat-${Math.random().toString(36).slice(2, 8)}` },
        select: { id: true },
      });
      const expense = await db.expense.create({
        data: {
          schoolId,
          categoryId: category.id,
          amount: opts.amount,
          incurredAt: opts.incurredAt,
          recordedBy: ownerId,
        },
        select: { id: true },
      });
      return expense.id;
    });
  }

  it("throws NotFoundError for an unknown termId", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-notfound");
    await expect(
      svc.getDashboard(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("totalInvoiced/totalCollected/collectionRatePercent cover ISSUED/PARTIALLY_PAID/PAID/OVERDUE and exclude DRAFT/CANCELLED", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-invoiced");
    const { termId, invoiceId: firstId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });
    const term = await withTenant(schoolId, (db) =>
      db.term.findUniqueOrThrow({ where: { id: termId }, select: { academicYearId: true } }),
    );

    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 80_000,
      totalPaid: 30_000,
      status: "PARTIALLY_PAID",
    });
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 50_000,
      totalPaid: 0,
      status: "OVERDUE",
    });
    // DRAFT: never issued, excluded from totalInvoiced.
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 999_999,
      totalPaid: 0,
      status: "DRAFT",
    });
    // CANCELLED: voided, excluded from totalInvoiced.
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 777_777,
      totalPaid: 0,
      status: "CANCELLED",
    });

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);

    // 100_000 (PAID) + 80_000 (PARTIALLY_PAID) + 50_000 (OVERDUE) — DRAFT and
    // CANCELLED contribute nothing.
    expect(dashboard.totalInvoiced).toBe(230_000);
    expect(dashboard.totalCollected).toBe(130_000); // 100_000 + 30_000 + 0
    expect(dashboard.collectionRatePercent).toBe(Math.round((130_000 / 230_000) * 100));
    expect(firstId).toBeTruthy();
  });

  it("REFUNDED invoice contributes totalDue to totalInvoiced, zero to totalCollected, and is excluded from outstandingBalance/debtorCount", async () => {
    // Mirrors slice 11: a full reversal recomputes totalPaid to 0 and moves
    // the invoice to the terminal REFUNDED status. REFUNDED is NOT one of
    // the debtor-set statuses (ISSUED/PARTIALLY_PAID/OVERDUE) — it's not
    // collectible, so it must not appear as outstanding either.
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-refunded");
    const { termId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 0,
      status: "REFUNDED",
    });

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);

    expect(dashboard.totalInvoiced).toBe(100_000); // REFUNDED counts as invoiced...
    expect(dashboard.totalCollected).toBe(0); // ...but not as collected (reversed to 0)
    expect(dashboard.outstandingBalance).toBe(0); // not outstanding — it's terminal, not collectible
    expect(dashboard.debtorCount).toBe(0); // not counted as a debtor
  });

  it("outstandingBalance and debtorCount count only ISSUED/PARTIALLY_PAID/OVERDUE", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-outstanding");
    const { termId, invoiceId: _issuedId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 0,
      status: "ISSUED",
    });
    const term = await withTenant(schoolId, (db) =>
      db.term.findUniqueOrThrow({ where: { id: termId }, select: { academicYearId: true } }),
    );
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 60_000,
      totalPaid: 20_000,
      status: "PARTIALLY_PAID",
    });
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 40_000,
      totalPaid: 0,
      status: "OVERDUE",
    });
    // PAID: fully settled, not outstanding.
    await addInvoice(schoolId, ownerId, termId, term.academicYearId, {
      totalDue: 30_000,
      totalPaid: 30_000,
      status: "PAID",
    });

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);

    // (100_000 - 0) + (60_000 - 20_000) + (40_000 - 0) = 180_000
    expect(dashboard.outstandingBalance).toBe(180_000);
    expect(dashboard.debtorCount).toBe(3);
  });

  it("collectionRatePercent is 0 when totalInvoiced is 0 (no divide-by-zero)", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-zero");
    // Only a DRAFT invoice exists — contributes nothing to totalInvoiced.
    const { termId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 0,
      status: "DRAFT",
    });

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);
    expect(dashboard.totalInvoiced).toBe(0);
    expect(dashboard.collectionRatePercent).toBe(0);
  });

  it("totalExpenses includes expenses within the term's date range (inclusive boundaries) and excludes those outside", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-expenses");
    const { termId } = await makeInvoice(schoolId, ownerId, { totalDue: 100_000, status: "ISSUED" });
    const term = await withTenant(schoolId, (db) =>
      db.term.findUniqueOrThrow({ where: { id: termId }, select: { startDate: true, endDate: true } }),
    );

    const dayBefore = new Date(term.startDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(term.endDate);
    dayAfter.setDate(dayAfter.getDate() + 1);

    await addExpense(schoolId, ownerId, { amount: 10_000, incurredAt: term.startDate }); // on boundary — included
    await addExpense(schoolId, ownerId, { amount: 20_000, incurredAt: term.endDate }); // on boundary — included
    await addExpense(schoolId, ownerId, { amount: 5_000, incurredAt: dayBefore }); // before term — excluded
    await addExpense(schoolId, ownerId, { amount: 7_000, incurredAt: dayAfter }); // after term — excluded

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);
    expect(dashboard.totalExpenses).toBe(30_000); // 10_000 + 20_000 only
  });

  it("netPosition = totalCollected - totalExpenses", async () => {
    const svc = new FinanceService();
    const { schoolId, ownerId } = await makeSchool("dash-net");
    const { termId } = await makeInvoice(schoolId, ownerId, {
      totalDue: 100_000,
      totalPaid: 100_000,
      status: "PAID",
    });
    const term = await withTenant(schoolId, (db) =>
      db.term.findUniqueOrThrow({ where: { id: termId }, select: { startDate: true } }),
    );
    await addExpense(schoolId, ownerId, { amount: 40_000, incurredAt: term.startDate });

    const dashboard = await svc.getDashboard(ctx(schoolId, ownerId), termId);
    expect(dashboard.totalCollected).toBe(100_000);
    expect(dashboard.totalExpenses).toBe(40_000);
    expect(dashboard.netPosition).toBe(60_000);
  });

  it("is isolated per school (RLS) — a term id from another school is treated as not found", async () => {
    const svc = new FinanceService();
    const a = await makeSchool("dash-iso-a");
    const b = await makeSchool("dash-iso-b");
    const { termId: termIdA } = await makeInvoice(a.schoolId, a.ownerId, {
      totalDue: 100_000,
      status: "ISSUED",
    });

    await expect(
      svc.getDashboard(ctx(b.schoolId, b.ownerId), termIdA),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
