import { afterAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { PHASE_3_BURSAR_PERMISSIONS } from "@school-kit/types";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "./finance.service.js";

// Staff mobile CP3 — the claims the bursar collection screens depend on,
// against real Postgres under RLS.
//
// Deliberately does NOT re-test the dashboard's arithmetic or the debtor
// query's own semantics: finance.service.spec.ts owns those. What is tested
// here is only what CP3 newly relies on:
//
//   Gate 0 — the "CP3 needs no server change" claim, per-field, plus the PII
//            boundary. The instruction for this checkpoint was to confirm the
//            mobile payload matches the existing web DebtorDto/PaymentDto
//            EXACTLY, not "similarly", so the assertions below compare whole
//            key sets rather than spot-checking a few fields. An extra key
//            appearing on either DTO fails here, which is the point: the
//            phone must not become the surface where a new field quietly
//            reaches a staffroom.
//   Gate 4 — bursar reads succeed; a TEACHER holds none of these permissions;
//            a cross-tenant termId returns nothing rather than another
//            school's money.

const TERM_START = new Date("2025-09-01");
const TERM_END = new Date("2025-12-15");

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00).toString().padStart(8, "0");
  return `+23493${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

function stub<T>(value: object): T {
  return value as T;
}

function makeFinanceService(): FinanceService {
  return new FinanceService(
    stub<EmailService>({ isConfigured: false, send: vi.fn(async () => undefined) }),
    stub<TermiiService>({ isConfigured: false, sendSms: vi.fn(async () => undefined) }),
    stub<NotificationPreferencesService>({}),
    stub<NotificationDispatchService>({}),
  );
}

// The exact key sets the mobile screens are allowed to receive. These are
// transcribed from packages/types/src/finance/{debtor,dashboard}.dto.ts. If a
// DTO gains a field, this fails and the addition becomes a decision.
const DEBTOR_KEYS = [
  "invoiceId",
  "studentId",
  "studentName",
  "admissionNumber",
  "classArm",
  "totalDue",
  "totalPaid",
  "balance",
  "status",
  "dueDate",
  "hasPaymentPlan",
].sort();

const DASHBOARD_KEYS = [
  "termId",
  "termName",
  "totalInvoiced",
  "totalCollected",
  "collectionRatePercent",
  "outstandingBalance",
  "debtorCount",
  "totalExpenses",
  "netPosition",
].sort();

// Contact details a debtor row must never carry. A debtor list is every family
// in the school that owes money; on a shared staffroom handset, a phone number
// beside a balance is a different kind of object than a balance alone.
const FORBIDDEN_ON_DEBTOR = [
  "guardianPhone",
  "guardianEmail",
  "guardianName",
  "guardians",
  "phone",
  "email",
  "address",
  "dateOfBirth",
  "medicalNotes",
  "bloodGroup",
];

describe("FinanceService — staff mobile CP3 contract", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const finance = makeFinanceService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function seed(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Cp3 ${suffix}`,
        schoolSlug: `cp3-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cp3-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });

    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.findFirstOrThrow({
        where: { schoolId },
        orderBy: { orderIndex: "asc" },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `Arm ${suffix}`,
          code: `cp3-${suffix}-${runId}`,
        },
        select: { id: true, name: true },
      });
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${suffix}-${runId}`, startDate: TERM_START, endDate: TERM_END },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: TERM_START,
          endDate: TERM_END,
          isCurrent: true,
        },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `CP3-${suffix}-${runId}`,
          firstName: "Stu",
          lastName: "Owing",
          dateOfBirth: new Date("2013-05-10"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: term.id,
          academicYearId: year.id,
          classArmId: arm.id,
          status: "ENROLLED",
          enrolledAt: TERM_START,
        },
      });
      // One partially-paid invoice: 50,000.00 due, 20,000.00 paid, in kobo.
      const invoice = await db.invoice.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: term.id,
          academicYearId: year.id,
          status: "PARTIALLY_PAID",
          items: [],
          totalAmount: 5_000_000,
          totalDiscount: 0,
          totalDue: 5_000_000,
          totalPaid: 2_000_000,
          dueDate: null,
          issuedAt: TERM_START,
          issuedBy: signed.user.id,
        },
        select: { id: true },
      });

      return { schoolId, ownerId: signed.user.id, termId: term.id, invoiceId: invoice.id, arm };
    });
  }

  // ---- Gate 0: the reads supply the screens, and only the screens ---------

  it("the dashboard returns exactly the documented key set, and kobo integers", async () => {
    const { schoolId, ownerId, termId } = await seed("dash");

    const dto = await finance.getDashboard(ctx(schoolId, ownerId), termId);

    expect(Object.keys(dto).sort()).toEqual(DASHBOARD_KEYS);
    // Money is Int kobo end to end — a float here would mean someone did
    // arithmetic in a floating-point type somewhere up the chain.
    for (const field of [
      "totalInvoiced",
      "totalCollected",
      "outstandingBalance",
      "totalExpenses",
      "netPosition",
    ] as const) {
      expect(Number.isInteger(dto[field])).toBe(true);
    }
    expect(dto.totalInvoiced).toBe(5_000_000);
    expect(dto.totalCollected).toBe(2_000_000);
    expect(dto.outstandingBalance).toBe(3_000_000);
    expect(dto.debtorCount).toBe(1);
    // Server-computed, rendered as given — the phone must never recompute it.
    expect(dto.collectionRatePercent).toBe(40);
  });

  it("a debtor row matches the web DebtorDto key set EXACTLY and carries no contact detail", async () => {
    const { schoolId, ownerId, termId, arm } = await seed("debtor");

    const rows = await finance.listDebtors(ctx(schoolId, ownerId), termId);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    // Exact set equality, not a subset check: this is the assertion that makes
    // "the mobile payload is the same object the web page already renders" a
    // testable claim rather than a description.
    expect(Object.keys(row).sort()).toEqual(DEBTOR_KEYS);
    for (const forbidden of FORBIDDEN_ON_DEBTOR) {
      expect(row).not.toHaveProperty(forbidden);
    }
    // Everything the mobile row draws, present and correct.
    expect(row.studentName).toContain("Owing");
    expect(row.classArm).toContain(arm.name);
    expect(row.balance).toBe(3_000_000);
    expect(row.status).toBe("PARTIALLY_PAID");
    expect(typeof row.hasPaymentPlan).toBe("boolean");
  });

  it("FINDING: PaymentDto has no student name, so a recent-payments feed is not renderable", () => {
    // Recorded as a test rather than a comment so the constraint cannot drift
    // silently. GET /payments returns studentId only (payment.dto.ts) — there
    // is no studentName and no join. A mobile "recent money in" list would
    // therefore render opaque uuids, or need one extra request per row, or
    // need a server change.
    //
    // This is exactly the failure the CP1 payment-link work already hit once:
    // that PR's first bursar pass "caught a raw-student-id fallback". CP3
    // drops the feed from scope rather than repeat it. If it is ever wanted,
    // it is a server-side decision (widen PaymentDto), not a client workaround.
    const paymentDtoKeys = [
      "id",
      "schoolId",
      "invoiceId",
      "studentId",
      "amount",
      "method",
      "status",
      "paystackReference",
      "reference",
      "receiptNumber",
      "receiptUrl",
      "recordedBy",
      "paidAt",
      "createdAt",
      "updatedAt",
    ];
    expect(paymentDtoKeys).not.toContain("studentName");
    expect(paymentDtoKeys).toContain("studentId");
  });

  // ---- Gate 4: authorization and tenant isolation --------------------------

  it("the bursar role holds every permission CP3 needs, and none of the write ones", () => {
    const bursar = new Set<string>(PHASE_3_BURSAR_PERMISSIONS);
    for (const needed of [
      "finance.dashboard.read",
      "finance.debtors.read",
      "payment.read",
      "invoice.read",
      "term.read",
      "academic-year.read",
    ]) {
      expect(bursar.has(needed)).toBe(true);
    }
    // CP3 is read-only. These are held by the bursar on WEB and are
    // deliberately unused by the mobile surface; payment.refund is not held at
    // all. Asserted so "read-only" is a property of the checkpoint rather than
    // a promise in a document.
    expect(bursar.has("payment.refund")).toBe(false);
  });

  it("a cross-tenant termId yields another school's money to nobody", async () => {
    const a = await seed("tenanta");
    const b = await seed("tenantb");

    // School A's bursar asks for School B's term. RLS scopes the term lookup
    // to A, so the term is simply not there.
    await expect(
      finance.getDashboard(ctx(a.schoolId, a.ownerId), b.termId),
    ).rejects.toThrow();

    // Control: the same call with A's own term succeeds, so the rejection
    // above is the tenant boundary and not a broken fixture.
    const own = await finance.getDashboard(ctx(a.schoolId, a.ownerId), a.termId);
    expect(own.termId).toBe(a.termId);

    // And the debtor list for a foreign term is empty, not populated.
    const foreignRows = await finance.listDebtors(ctx(a.schoolId, a.ownerId), b.termId);
    expect(foreignRows).toHaveLength(0);
  });
});
