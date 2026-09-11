import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import type { InvoiceStatus } from "@school-kit/db";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { DashboardService } from "../dashboard/dashboard.service.js";
import { FinanceService } from "./finance.service.js";
import { buildFinanceTotalsFromRows } from "./finance-totals.js";

// ---------------------------------------------------------------------------
// The drift gate for finance-totals.ts.
//
// GET /finance/dashboard computes billed / collected / outstanding / debtor
// count with DB-side SUM aggregates. GET /dashboard derives the same five
// figures in JS from invoice rows it already holds. Two execution strategies
// over ONE definition is a real risk, and it was accepted deliberately: the
// alternative was either the nested transaction that deadlocked production
// (2026-09-11) or making the finance KPI read scan every invoice row, which
// D5 of docs/modules/revenue-trajectory.md decided against.
//
// So the mitigation is this spec rather than a comment. It runs BOTH paths
// against the SAME real school and asserts field-by-field equality, over a
// fixture chosen to hit every way the two could disagree:
//   - every InvoiceStatus, including the ones each path treats differently
//   - DRAFT and CANCELLED, which must be excluded from billed totals
//   - PAID and REFUNDED, which are billed but NOT outstanding
//   - an invoice whose student has no enrollment row for the term
//   - a partially-paid invoice, so collected != billed and the rate is
//     neither 0 nor 100
//
// NOT covered, because the schema forbids it: a student holding several
// invoices in one term. Invoice carries @@unique([schoolId, studentId,
// termId]), so within a term "count of invoices" and "count of distinct
// students" are the same number by construction.
// ---------------------------------------------------------------------------

function makeFinanceService(): FinanceService {
  return new FinanceService(
    { isConfigured: false, send: async () => undefined } as unknown as EmailService,
    { isConfigured: false, sendSms: async () => undefined } as unknown as TermiiService,
    {
      getEnabledChannels: async () => ({ email: true, sms: false, push: false }),
    } as unknown as NotificationPreferencesService,
    { notifyGuardian: async () => "SMS" as const } as unknown as NotificationDispatchService,
  );
}

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23484${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

describe("finance totals parity: DB aggregates vs row derivation", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("both paths produce identical figures across every invoice status", async () => {
    const signed = await auth.signupOwner(
      {
        schoolName: `Parity ${runId}`,
        schoolSlug: `parity-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Admin",
        ownerEmail: `parity-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "test" },
    );
    const schoolId = signed.school.id;
    const ownerId = signed.user.id;
    schoolIds.add(schoolId);

    const termId = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-parity-${runId}`,
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
          isCurrent: true,
        },
        select: { id: true },
      });
      const level = await db.classLevel.create({
        data: { schoolId, name: "JSS 1", code: `jss1-${runId}`, stage: "JSS", orderIndex: 7 },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS 1A", code: `jss1a-${runId}` },
        select: { id: true },
      });

      let n = 0;
      async function student(enrolled: boolean): Promise<string> {
        n += 1;
        const s = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `ADM-PAR-${n}-${runId}`,
            firstName: `S${n}`,
            lastName: "Parity",
            dateOfBirth: new Date("2011-01-01"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        if (enrolled) {
          await db.enrollment.create({
            data: {
              schoolId,
              studentId: s.id,
              termId: term.id,
              academicYearId: year.id,
              classArmId: arm.id,
            },
          });
        }
        return s.id;
      }

      async function invoice(
        studentId: string,
        status: InvoiceStatus,
        totalDue: number,
        totalPaid: number,
      ) {
        await db.invoice.create({
          data: {
            schoolId,
            studentId,
            termId: term.id,
            academicYearId: year.id,
            status,
            items: [],
            totalAmount: totalDue,
            totalDiscount: 0,
            totalDue,
            totalPaid,
            issuedAt: new Date(),
            issuedBy: ownerId,
          },
        });
      }

      // Every status, with amounts distinct enough that any mis-bucketing
      // changes a total rather than cancelling out. One invoice per student:
      // @@unique([schoolId, studentId, termId]).
      await invoice(await student(true), "ISSUED", 100_000, 0);
      await invoice(await student(true), "PARTIALLY_PAID", 200_000, 75_000);
      await invoice(await student(true), "OVERDUE", 50_000, 10_000);
      await invoice(await student(true), "PAID", 300_000, 300_000);
      await invoice(await student(true), "REFUNDED", 40_000, 40_000);
      await invoice(await student(true), "DRAFT", 999_000, 0); // must not count
      await invoice(await student(true), "CANCELLED", 888_000, 0); // must not count
      // No enrollment row: still belongs to the term's totals (see #278).
      await invoice(await student(false), "ISSUED", 25_000, 5_000);

      return term.id;
    });

    const authCtx = { sessionId: "sess", userId: ownerId, schoolId };

    const viaAggregates = await makeFinanceService().getDashboard(authCtx, termId);
    const viaDashboard = await new DashboardService().getAdminDashboard(authCtx, termId);

    // Independent third computation straight from the rows, so a shared bug in
    // BOTH production paths cannot make this spec pass by symmetry.
    const rows = await withTenant(schoolId, async (db) =>
      db.invoice.findMany({
        where: { termId, status: { notIn: ["DRAFT", "CANCELLED"] } },
        select: { status: true, totalDue: true, totalPaid: true },
      }),
    );
    const direct = buildFinanceTotalsFromRows(rows);

    // Hand-computed from the fixture above; DRAFT and CANCELLED excluded.
    const expectedBilled = 100_000 + 200_000 + 50_000 + 300_000 + 40_000 + 25_000;
    const expectedCollected = 0 + 75_000 + 10_000 + 300_000 + 40_000 + 5_000;
    // ISSUED + PARTIALLY_PAID + OVERDUE + ISSUED(unenrolled) = 4 invoices
    const expectedOutstanding =
      100_000 + 200_000 + 50_000 + 25_000 - (0 + 75_000 + 10_000 + 5_000);

    expect(direct.totalInvoiced).toBe(expectedBilled);
    expect(direct.totalCollected).toBe(expectedCollected);
    expect(direct.outstandingBalance).toBe(expectedOutstanding);
    expect(direct.debtorCount).toBe(4);

    // The parity assertions themselves.
    expect(viaDashboard.fees.billed).toBe(viaAggregates.totalInvoiced);
    expect(viaDashboard.fees.collected).toBe(viaAggregates.totalCollected);
    expect(viaDashboard.fees.percent).toBe(viaAggregates.collectionRatePercent);
    expect(viaDashboard.outstanding.amount).toBe(viaAggregates.outstandingBalance);
    expect(viaDashboard.outstanding.debtorCount).toBe(viaAggregates.debtorCount);

    // And both agree with the independent computation.
    expect(viaAggregates.totalInvoiced).toBe(direct.totalInvoiced);
    expect(viaAggregates.totalCollected).toBe(direct.totalCollected);
    expect(viaAggregates.collectionRatePercent).toBe(direct.collectionRatePercent);
    expect(viaAggregates.outstandingBalance).toBe(direct.outstandingBalance);
    expect(viaAggregates.debtorCount).toBe(direct.debtorCount);

    // Guard against a degenerate fixture: a 0% or 100% rate would let several
    // arithmetic mistakes through unnoticed.
    expect(viaAggregates.collectionRatePercent).toBeGreaterThan(0);
    expect(viaAggregates.collectionRatePercent).toBeLessThan(100);
  });
});
