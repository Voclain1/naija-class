import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "./finance.service.js";

// Revenue trajectory — integration spec. Real DB via withTenant, each test
// creates its own isolated school. Same discipline as dashboard.service.spec.ts
// and finance.service.spec.ts: no mocked Prisma, because this is aggregation
// logic and a mock would assert the query I wrote rather than the rows
// Postgres actually returns.
//
// EVERY date fixture here is built with Date.UTC(...), never local time.
// dashboard.service.spec.ts carries the reasoning and it is worth restating:
// a local-time fixture "would silently agree with a local-time bug in the
// service under test (both wrong the same way) and never catch it". The whole
// point of D1 in docs/modules/revenue-trajectory.md is that the UTC choice is
// deliberate, so the spec has to be able to fail if someone changes it.

function makeFinanceService(): FinanceService {
  const email = { isConfigured: false, send: async () => undefined } as unknown as EmailService;
  const termii = { isConfigured: false, sendSms: async () => undefined } as unknown as TermiiService;
  const notificationPreferences = {
    getEnabledChannels: async () => ({ email: true, sms: false, push: false }),
  } as unknown as NotificationPreferencesService;
  const dispatch = {
    notifyGuardian: async () => "SMS" as const,
  } as unknown as NotificationDispatchService;
  return new FinanceService(email, termii, notificationPreferences, dispatch);
}

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23485${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const TODAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
);
const DAY = 24 * 60 * 60 * 1000;

/** `n` days from today, at UTC midnight. Negative is in the past. */
function daysFromToday(n: number): Date {
  return new Date(TODAY.getTime() + n * DAY);
}

describe("FinanceService.getRevenueTrajectory (integration)", () => {
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

  function ctx(schoolId: string, userId: string) {
    return { sessionId: "sess", userId, schoolId };
  }

  let schoolSeq = 0;
  async function makeSchool(): Promise<{ schoolId: string; ownerId: string }> {
    schoolSeq += 1;
    const suffix = `${runId}-${schoolSeq}`;
    const signed = await auth.signupOwner(
      {
        schoolName: `Traj ${suffix}`,
        schoolSlug: `traj-${suffix}`,
        ownerFirstName: "Ngozi",
        ownerLastName: "Bursar",
        ownerEmail: `traj-${suffix}@example.test`,
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

  let termSeq = 0;
  async function makeTerm(schoolId: string, startDate: Date, endDate: Date) {
    termSeq += 1;
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${runId}-${termSeq}`,
          startDate,
          endDate,
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate,
          endDate,
        },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id };
    });
  }

  let studentSeq = 0;
  /**
   * One invoice, optionally with one payment. `issuedAt: null` exercises the
   * createdAt fallback (D4). `paymentStatus` exercises the SUCCESS filter (D3).
   */
  async function addInvoice(
    schoolId: string,
    ownerId: string,
    yearId: string,
    termId: string,
    opts: {
      totalDue: number;
      issuedAt: Date | null;
      invoiceStatus?: "ISSUED" | "PAID" | "DRAFT" | "CANCELLED";
      payment?: { amount: number; paidAt: Date; status?: "SUCCESS" | "REVERSED" };
    },
  ) {
    studentSeq += 1;
    return withTenant(schoolId, async (db) => {
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-TRJ-${runId}-${studentSeq}`,
          firstName: "Ada",
          lastName: `Test${studentSeq}`,
          dateOfBirth: new Date(Date.UTC(2012, 0, 1)),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      // totalPaid mirrors the SUCCESS payment so the invoice-level totals
      // (what getDashboard reads) agree with the payment-level series (what
      // the trajectory buckets). A REVERSED payment contributes 0, exactly as
      // refunds.service.ts recomputes it.
      const paidSum =
        opts.payment && (opts.payment.status ?? "SUCCESS") === "SUCCESS" ? opts.payment.amount : 0;
      const invoice = await db.invoice.create({
        data: {
          schoolId,
          studentId: student.id,
          termId,
          academicYearId: yearId,
          status: opts.invoiceStatus ?? "ISSUED",
          items: [],
          totalAmount: opts.totalDue,
          totalDiscount: 0,
          totalDue: opts.totalDue,
          totalPaid: paidSum,
          dueDate: null,
          issuedAt: opts.issuedAt,
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      if (opts.payment) {
        await db.payment.create({
          data: {
            schoolId,
            invoiceId: invoice.id,
            studentId: student.id,
            amount: opts.payment.amount,
            method: "CASH",
            status: opts.payment.status ?? "SUCCESS",
            paidAt: opts.payment.paidAt,
            recordedBy: ownerId,
          },
        });
      }
      return { invoiceId: invoice.id, studentId: student.id };
    });
  }

  const inTerm = (b: { kind: string }) => b.kind === "IN_TERM";

  // ─── Term-boundary cases (D2) ─────────────────────────────────────────────

  it("term not yet started: no negative range, all in-term weeks are future/null", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const { termId } = await makeTerm(schoolId, daysFromToday(14), daysFromToday(14 + 6 * 7));

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);

    expect(res.buckets.length).toBeGreaterThan(0);
    const weeks = res.buckets.filter(inTerm);
    expect(weeks.length).toBeGreaterThan(0);
    // Every in-term week lies ahead: no data yet, and NOT zero.
    expect(weeks.every((b) => b.isFuture)).toBe(true);
    expect(weeks.every((b) => b.invoiced === null && b.collected === null)).toBe(true);
    expect(weeks.some((b) => b.invoiced === 0)).toBe(false);
  });

  it("term not yet started but already invoiced and paid: the BEFORE_TERM bucket carries it and the series reconciles", async () => {
    // This is the case that found the original D2 bug — a leading bucket did
    // not exist, so early money vanished from the curve entirely.
    const { schoolId, ownerId } = await makeSchool();
    const { yearId, termId } = await makeTerm(schoolId, daysFromToday(14), daysFromToday(14 + 6 * 7));

    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 500_000,
      issuedAt: daysFromToday(-3),
      payment: { amount: 200_000, paidAt: daysFromToday(-2) },
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);

    const before = res.buckets.find((b) => b.kind === "BEFORE_TERM");
    expect(before).toBeDefined();
    expect(before!.invoiced).toBe(500_000);
    expect(before!.collected).toBe(200_000);

    expect(res.totalInvoiced).toBe(500_000);
    expect(res.totalCollected).toBe(200_000);
    // Last non-null cumulative value === the totals.
    const lastKnown = [...res.buckets].reverse().find((b) => b.collected !== null)!;
    expect(lastKnown.invoiced).toBe(res.totalInvoiced);
    expect(lastKnown.collected).toBe(res.totalCollected);
  });

  it("term already ended: full week span, plus an AFTER_TERM bucket for a late payment", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const start = daysFromToday(-120);
    const end = daysFromToday(-40);
    const { yearId, termId } = await makeTerm(schoolId, start, end);

    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 300_000,
      issuedAt: daysFromToday(-118),
      payment: { amount: 100_000, paidAt: daysFromToday(-110) },
    });
    // Arrears settled well after the term closed.
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 200_000,
      issuedAt: daysFromToday(-118),
      payment: { amount: 150_000, paidAt: daysFromToday(-5) },
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);

    const after = res.buckets.find((b) => b.kind === "AFTER_TERM");
    expect(after).toBeDefined();
    // Nothing is "future" in a term that has already ended.
    expect(res.buckets.every((b) => !b.isFuture)).toBe(true);
    expect(res.totalCollected).toBe(250_000);
    expect(after!.collected).toBe(250_000);
    expect(after!.invoiced).toBe(500_000);
  });

  it("term in progress: past weeks carry numbers, trailing future weeks are null", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const { yearId, termId } = await makeTerm(schoolId, daysFromToday(-21), daysFromToday(42));

    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 400_000,
      issuedAt: daysFromToday(-20),
      payment: { amount: 250_000, paidAt: daysFromToday(-14) },
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const weeks = res.buckets.filter(inTerm);

    expect(weeks.some((b) => b.isFuture)).toBe(true);
    expect(weeks.some((b) => !b.isFuture)).toBe(true);
    // No hole in the middle: once a bucket is future, every later one is too.
    const firstFuture = weeks.findIndex((b) => b.isFuture);
    expect(weeks.slice(firstFuture).every((b) => b.isFuture)).toBe(true);
    expect(weeks.slice(0, firstFuture).every((b) => b.invoiced !== null)).toBe(true);
    // Cumulative and non-decreasing across the known part.
    const known = weeks.filter((b) => b.collected !== null).map((b) => b.collected!);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(known.at(-1)).toBe(250_000);
  });

  it("single-day term yields exactly one in-term bucket", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const day = daysFromToday(-10);
    const { termId } = await makeTerm(schoolId, day, day);
    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    expect(res.buckets.filter(inTerm).length).toBe(1);
  });

  // ─── Week-boundary calculations (D1) ──────────────────────────────────────

  it("derives week count from the term's real stored dates, not a fixed number", async () => {
    const { schoolId, ownerId } = await makeSchool();
    // Wednesday 2025-09-03 → Wednesday 2025-10-15. Monday-snapped, that is
    // 2025-09-01 .. 2025-10-13 inclusive = 7 weeks.
    const { termId } = await makeTerm(
      schoolId,
      new Date(Date.UTC(2025, 8, 3)),
      new Date(Date.UTC(2025, 9, 15)),
    );
    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const weeks = res.buckets.filter(inTerm);
    expect(weeks.length).toBe(7);
    // Term starts mid-week: bucket 1 begins on the Monday BEFORE startDate,
    // deliberately, so finance weeks align with the attendance trend's weeks.
    expect(weeks[0]!.weekStart).toBe("2025-09-01");
    expect(res.termStartDate).toBe("2025-09-03");
    expect(weeks.at(-1)!.weekStart).toBe("2025-10-13");
  });

  it("spans a year boundary without an off-by-one", async () => {
    const { schoolId, ownerId } = await makeSchool();
    // Mon 2025-12-15 .. Mon 2026-01-12 = 5 weekly buckets across new year.
    const { termId } = await makeTerm(
      schoolId,
      new Date(Date.UTC(2025, 11, 15)),
      new Date(Date.UTC(2026, 0, 12)),
    );
    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const weeks = res.buckets.filter(inTerm).map((b) => b.weekStart);
    expect(weeks).toEqual([
      "2025-12-15",
      "2025-12-22",
      "2025-12-29",
      "2026-01-05",
      "2026-01-12",
    ]);
  });

  it("UTC, not Africa/Lagos: a payment at 00:30 Lagos Monday lands in the EARLIER week (D1)", async () => {
    // 2025-10-06 is a Monday. 00:30 Lagos == 2025-10-05T23:30Z, i.e. Sunday in
    // UTC, so it belongs to the week starting 2025-09-29. Under an
    // Africa/Lagos convention it would land in the 2025-10-06 week instead.
    // This test is the tripwire for D1: if someone switches the service to
    // Lagos, this fails and the name says why it was UTC on purpose.
    const { schoolId, ownerId } = await makeSchool();
    const { yearId, termId } = await makeTerm(
      schoolId,
      new Date(Date.UTC(2025, 8, 29)),
      new Date(Date.UTC(2025, 9, 12)),
    );
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 100_000,
      issuedAt: new Date(Date.UTC(2025, 8, 29, 9, 0)),
      payment: { amount: 100_000, paidAt: new Date(Date.UTC(2025, 9, 5, 23, 30)) },
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const weeks = res.buckets.filter(inTerm);
    const w0 = weeks.find((b) => b.weekStart === "2025-09-29")!;
    const w1 = weeks.find((b) => b.weekStart === "2025-10-06")!;
    // Cumulative: the money is already counted by the end of week 1.
    expect(w0.collected).toBe(100_000);
    expect(w1.collected).toBe(100_000);
  });

  // ─── Aggregation correctness (D3, D4) ─────────────────────────────────────

  it("excludes REVERSED payments and CANCELLED invoices (D3)", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const { yearId, termId } = await makeTerm(schoolId, daysFromToday(-60), daysFromToday(-10));

    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 100_000,
      issuedAt: daysFromToday(-55),
      payment: { amount: 100_000, paidAt: daysFromToday(-50) },
    });
    // Refunded: payment REVERSED, invoice totalPaid back to 0.
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 100_000,
      issuedAt: daysFromToday(-55),
      payment: { amount: 100_000, paidAt: daysFromToday(-50), status: "REVERSED" },
    });
    // Cancelled invoice with a payment against it — excluded on both lines.
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 999_000,
      issuedAt: daysFromToday(-55),
      invoiceStatus: "CANCELLED",
      payment: { amount: 999_000, paidAt: daysFromToday(-50) },
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const last = [...res.buckets].reverse().find((b) => b.collected !== null)!;

    expect(res.totalInvoiced).toBe(200_000); // cancelled one excluded
    expect(res.totalCollected).toBe(100_000); // reversed one excluded
    expect(last.collected).toBe(100_000);
    expect(last.invoiced).toBe(200_000);
  });

  it("an invoice with null issuedAt still appears, via the createdAt fallback (D4)", async () => {
    const { schoolId, ownerId } = await makeSchool();
    // createdAt defaults to now(), so the term must contain today for the
    // fallback row to land in a real bucket.
    const { yearId, termId } = await makeTerm(schoolId, daysFromToday(-7), daysFromToday(7));
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 250_000,
      issuedAt: null,
    });

    const res = await finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId);
    const last = [...res.buckets].reverse().find((b) => b.invoiced !== null)!;
    expect(res.totalInvoiced).toBe(250_000);
    expect(last.invoiced).toBe(250_000);
  });

  // ─── The reconciliation test ──────────────────────────────────────────────

  it("reconciles against getDashboard for the same term: early, in-term, late, and reversed", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const { yearId, termId } = await makeTerm(schoolId, daysFromToday(-70), daysFromToday(-14));

    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 400_000,
      issuedAt: daysFromToday(-80), // invoiced BEFORE the term began
      payment: { amount: 100_000, paidAt: daysFromToday(-75) }, // paid early
    });
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 300_000,
      issuedAt: daysFromToday(-60),
      payment: { amount: 300_000, paidAt: daysFromToday(-50) }, // in term
    });
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 200_000,
      issuedAt: daysFromToday(-60),
      payment: { amount: 50_000, paidAt: daysFromToday(-3) }, // after term end
    });
    await addInvoice(schoolId, ownerId, yearId, termId, {
      totalDue: 100_000,
      issuedAt: daysFromToday(-60),
      payment: { amount: 100_000, paidAt: daysFromToday(-40), status: "REVERSED" },
    });

    const [traj, dash] = await Promise.all([
      finance.getRevenueTrajectory(ctx(schoolId, ownerId), termId),
      finance.getDashboard(ctx(schoolId, ownerId), termId),
    ]);

    // The chart's own totals must equal the KPI card's.
    expect(traj.totalInvoiced).toBe(dash.totalInvoiced);
    expect(traj.totalCollected).toBe(dash.totalCollected);

    // And the curve must actually END there — this is the assertion that
    // catches a missing out-of-term bucket, which is the whole point of D2.
    const last = traj.buckets.at(-1)!;
    expect(last.invoiced).toBe(dash.totalInvoiced);
    expect(last.collected).toBe(dash.totalCollected);

    expect(traj.buckets.some((b) => b.kind === "BEFORE_TERM")).toBe(true);
    expect(traj.buckets.some((b) => b.kind === "AFTER_TERM")).toBe(true);
  });

  // ─── Tenancy and errors ───────────────────────────────────────────────────

  it("is tenant-isolated: school B cannot read school A's term", async () => {
    const a = await makeSchool();
    const b = await makeSchool();
    const { yearId, termId } = await makeTerm(a.schoolId, daysFromToday(-30), daysFromToday(-1));
    await addInvoice(a.schoolId, a.ownerId, yearId, termId, {
      totalDue: 777_000,
      issuedAt: daysFromToday(-20),
    });

    // Same termId, school B's auth context — RLS must make it invisible.
    await expect(finance.getRevenueTrajectory(ctx(b.schoolId, b.ownerId), termId)).rejects.toThrow(
      NotFoundError,
    );

    const mine = await finance.getRevenueTrajectory(ctx(a.schoolId, a.ownerId), termId);
    expect(mine.totalInvoiced).toBe(777_000);
  });

  it("throws NotFoundError for an unknown termId", async () => {
    const { schoolId, ownerId } = await makeSchool();
    await expect(
      finance.getRevenueTrajectory(ctx(schoolId, ownerId), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});
