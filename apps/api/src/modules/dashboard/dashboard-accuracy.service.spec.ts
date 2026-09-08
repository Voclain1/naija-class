import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "../finance/finance.service.js";
import { DashboardService } from "./dashboard.service.js";

// Three pre-existing data-correctness defects on the admin dashboard, each
// proved fixed against real Postgres. These are NOT redesign scope — all three
// were live on a screen admins use daily, and two of them made two numbers on
// the SAME screen contradict each other.
//
// Defect 1 — the attendance trend could not tell a holiday from total absence.
// Defect 2 — collectionByGroup silently dropped invoices, so its rows did not
//            sum to the fees KPI card directly above them.
// Defect 3 — the overdue-fees alert counted every term ever, while the page it
//            links to is term-scoped.
//
// Dates are built with Date.UTC(...) throughout, for the reason
// dashboard.service.spec.ts states: a local-time fixture would agree with a
// local-time bug and never catch it.

function makeFinanceService(): FinanceService {
  const email = { isConfigured: false, send: async () => undefined } as unknown as EmailService;
  const termii = { isConfigured: false, sendSms: async () => undefined } as unknown as TermiiService;
  const prefs = {
    getEnabledChannels: async () => ({ email: true, sms: false, push: false }),
  } as unknown as NotificationPreferencesService;
  const dispatch = {
    notifyGuardian: async () => "SMS" as const,
  } as unknown as NotificationDispatchService;
  return new FinanceService(email, termii, prefs, dispatch);
}

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23486${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const TODAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * DAY);

describe("DashboardService accuracy fixes (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const svc = new DashboardService(makeFinanceService());
  const schoolIds = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const ctx = (schoolId: string, userId: string) => ({ sessionId: "sess", userId, schoolId });

  let seq = 0;
  async function makeSchool(): Promise<{ schoolId: string; ownerId: string }> {
    seq += 1;
    const suffix = `${runId}-${seq}`;
    const signed = await auth.signupOwner(
      {
        schoolName: `Acc ${suffix}`,
        schoolSlug: `acc-${suffix}`,
        ownerFirstName: "Tunde",
        ownerLastName: "Admin",
        ownerEmail: `acc-${suffix}@example.test`,
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

  /** A school with a current term, one class level and one arm. */
  async function makeScaffold(schoolId: string) {
    seq += 1;
    const tag = `${runId}-${seq}`;
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${tag}`,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2026, 11, 31)),
          isCurrent: true,
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date(Date.UTC(2026, 0, 5)),
          endDate: new Date(Date.UTC(2026, 3, 1)),
          isCurrent: true,
        },
        select: { id: true },
      });
      const level = await db.classLevel.create({
        data: { schoolId, name: "JSS 1", code: `jss1-${tag}`, stage: "JSS", orderIndex: 7 },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS 1A", code: `jss1a-${tag}` },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id, levelId: level.id, armId: arm.id };
    });
  }

  let studentSeq = 0;
  async function makeStudent(schoolId: string) {
    studentSeq += 1;
    return withTenant(schoolId, async (db) =>
      db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-ACC-${runId}-${studentSeq}`,
          firstName: "Chidi",
          lastName: `Test${studentSeq}`,
          dateOfBirth: new Date(Date.UTC(2012, 0, 1)),
          gender: "MALE",
        },
        select: { id: true },
      }),
    );
  }

  // ─── Defect 1 — holiday vs total absence ──────────────────────────────────

  describe("defect 1: the attendance trend distinguishes an unmarked week from a 0% week", () => {
    it("reports totalMarked 0 and percentPresent null for a week with no register", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const student = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.armId,
          },
        });
        // Marked THIS week only. Every earlier week in the 8-week window has
        // no register at all — the holiday case.
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: student.id,
            classArmId: sc.armId,
            termId: sc.termId,
            date: TODAY,
            status: "PRESENT",
            markedBy: ownerId,
          },
        });
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      const trend = res.attendanceTrend;

      const marked = trend.filter((w) => w.totalMarked > 0);
      const unmarked = trend.filter((w) => w.totalMarked === 0);

      expect(marked).toHaveLength(1);
      expect(marked[0]!.percentPresent).toBe(100);

      // The regression: these used to arrive as percentPresent 0, which the
      // chart drew as a dive to the floor.
      expect(unmarked.length).toBeGreaterThan(0);
      expect(unmarked.every((w) => w.percentPresent === null)).toBe(true);
      expect(unmarked.some((w) => w.percentPresent === 0)).toBe(false);
    });

    it("a week where everyone was absent still reports 0, not null", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const student = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.armId,
          },
        });
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: student.id,
            classArmId: sc.armId,
            termId: sc.termId,
            date: TODAY,
            status: "ABSENT",
            markedBy: ownerId,
          },
        });
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      const thisWeek = res.attendanceTrend.filter((w) => w.totalMarked > 0);

      expect(thisWeek).toHaveLength(1);
      // The distinction the whole fix exists for: real 0 vs absent data.
      expect(thisWeek[0]!.percentPresent).toBe(0);
      expect(thisWeek[0]!.totalMarked).toBe(1);
    });
  });

  // ─── Defect 2 — collectionByGroup must sum to the KPI ─────────────────────

  describe("defect 2: collectionByGroup sums to the fees card above it", () => {
    it("puts an invoice with no enrollment into Unassigned instead of dropping it", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);

      const enrolled = await makeStudent(schoolId);
      const orphan = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: enrolled.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.armId,
          },
        });
        // Enrolled student's invoice — groups under JSS 1.
        await db.invoice.create({
          data: {
            schoolId,
            studentId: enrolled.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "ISSUED",
            items: [],
            totalAmount: 300_000,
            totalDiscount: 0,
            totalDue: 300_000,
            totalPaid: 100_000,
            issuedAt: daysAgo(5),
            issuedBy: ownerId,
          },
        });
        // No enrollment row for this term — previously dropped on the floor.
        await db.invoice.create({
          data: {
            schoolId,
            studentId: orphan.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "ISSUED",
            items: [],
            totalAmount: 200_000,
            totalDiscount: 0,
            totalDue: 200_000,
            totalPaid: 50_000,
            issuedAt: daysAgo(5),
            issuedBy: ownerId,
          },
        });
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);

      const unassigned = res.collectionByGroup.find((g) => g.groupId === "unassigned");
      expect(unassigned).toBeDefined();
      expect(unassigned!.label).toBe("Unassigned");
      expect(unassigned!.billed).toBe(200_000);
      expect(unassigned!.collected).toBe(50_000);

      // THE assertion: the breakdown reconciles with the card above it.
      const billedSum = res.collectionByGroup.reduce((t, g) => t + g.billed, 0);
      const collectedSum = res.collectionByGroup.reduce((t, g) => t + g.collected, 0);
      expect(billedSum).toBe(res.fees.billed);
      expect(collectedSum).toBe(res.fees.collected);
      expect(billedSum).toBe(500_000);
      expect(collectedSum).toBe(150_000);
    });

    it("sorts Unassigned last, after every real class level", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const enrolled = await makeStudent(schoolId);
      const orphan = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: enrolled.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.armId,
          },
        });
        for (const sid of [enrolled.id, orphan.id]) {
          await db.invoice.create({
            data: {
              schoolId,
              studentId: sid,
              termId: sc.termId,
              academicYearId: sc.yearId,
              status: "ISSUED",
              items: [],
              totalAmount: 100_000,
              totalDiscount: 0,
              totalDue: 100_000,
              totalPaid: 0,
              issuedAt: daysAgo(3),
              issuedBy: ownerId,
            },
          });
        }
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      expect(res.collectionByGroup).toHaveLength(2);
      expect(res.collectionByGroup.at(-1)!.groupId).toBe("unassigned");
    });

    it("emits no Unassigned bucket when every invoice has an enrollment", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const student = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.armId,
          },
        });
        await db.invoice.create({
          data: {
            schoolId,
            studentId: student.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "ISSUED",
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid: 0,
            issuedAt: daysAgo(3),
            issuedBy: ownerId,
          },
        });
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      expect(res.collectionByGroup.some((g) => g.groupId === "unassigned")).toBe(false);
    });
  });

  // ─── Defect 3 — overdue count agrees with the page it links to ────────────

  describe("defect 3: the overdue-fees alert is scoped to the current term", () => {
    it("counts only the current term's overdue invoices, not every term ever", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const s1 = await makeStudent(schoolId);
      const s2 = await makeStudent(schoolId);

      const oldTermId = await withTenant(schoolId, async (db) => {
        // A closed, non-current term carrying its own overdue invoice.
        const old = await db.term.create({
          data: {
            schoolId,
            academicYearId: sc.yearId,
            sequence: 2,
            name: "Prior Term",
            startDate: new Date(Date.UTC(2025, 8, 1)),
            endDate: new Date(Date.UTC(2025, 11, 15)),
            isCurrent: false,
          },
          select: { id: true },
        });
        await db.invoice.create({
          data: {
            schoolId,
            studentId: s1.id,
            termId: old.id,
            academicYearId: sc.yearId,
            status: "OVERDUE",
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid: 0,
            issuedAt: daysAgo(200),
            issuedBy: ownerId,
          },
        });
        // One overdue invoice in the CURRENT term.
        await db.invoice.create({
          data: {
            schoolId,
            studentId: s2.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "OVERDUE",
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid: 0,
            issuedAt: daysAgo(10),
            issuedBy: ownerId,
          },
        });
        return old.id;
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      const alert = res.needsYouToday.find((a) => a.type === "overdue_fees")!;

      // Two overdue invoices exist school-wide; only one is in the current
      // term, which is what /finance/debtors would show.
      expect(alert.count).toBe(1);
      expect(oldTermId).toBeTruthy();
    });

    it("stays scoped to the CURRENT term even when browsing a historical term", async () => {
      // The original comment's intent — this alert reflects the real-world
      // moment, not whichever term the admin is looking at — is preserved.
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const s1 = await makeStudent(schoolId);

      const priorTermId = await withTenant(schoolId, async (db) => {
        const prior = await db.term.create({
          data: {
            schoolId,
            academicYearId: sc.yearId,
            sequence: 3,
            name: "Older Term",
            startDate: new Date(Date.UTC(2025, 0, 5)),
            endDate: new Date(Date.UTC(2025, 3, 1)),
            isCurrent: false,
          },
          select: { id: true },
        });
        await db.invoice.create({
          data: {
            schoolId,
            studentId: s1.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "OVERDUE",
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid: 0,
            issuedAt: daysAgo(10),
            issuedBy: ownerId,
          },
        });
        return prior.id;
      });

      // Ask for the OLD term's dashboard; the alert still reports current.
      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), priorTermId);
      const alert = res.needsYouToday.find((a) => a.type === "overdue_fees")!;
      expect(alert.count).toBe(1);
    });

    it("reports 0 rather than a cross-term total when no term is flagged current", async () => {
      const { schoolId, ownerId } = await makeSchool();
      const sc = await makeScaffold(schoolId);
      const s1 = await makeStudent(schoolId);

      await withTenant(schoolId, async (db) => {
        await db.invoice.create({
          data: {
            schoolId,
            studentId: s1.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            status: "OVERDUE",
            items: [],
            totalAmount: 100_000,
            totalDiscount: 0,
            totalDue: 100_000,
            totalPaid: 0,
            issuedAt: daysAgo(10),
            issuedBy: ownerId,
          },
        });
        await db.term.update({ where: { id: sc.termId }, data: { isCurrent: false } });
      });

      const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
      const alert = res.needsYouToday.find((a) => a.type === "overdue_fees")!;
      expect(alert.count).toBe(0);
    });
  });
});
