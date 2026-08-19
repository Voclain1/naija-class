import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "../finance/finance.service.js";
import { DashboardService } from "./dashboard.service.js";

// Visual/UX overhaul initiative — admin dashboard aggregation. Integration
// spec, same discipline as finance.service.spec.ts: real DB via withTenant,
// each test creates its own isolated school.

function makeFinanceService(): FinanceService {
  const email = {
    isConfigured: false,
    send: async () => undefined,
  } as unknown as EmailService;
  const termii = {
    isConfigured: false,
    sendSms: async () => undefined,
  } as unknown as TermiiService;
  const notificationPreferences = {
    getEnabledChannels: async () => ({ email: true, sms: false, push: false }),
  } as unknown as NotificationPreferencesService;
  // push OFF, so the dispatch answer is the pre-slice-5 behaviour: SMS.
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
  return `+23484${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

// UTC, matching dashboard.service.ts's startOfDay — AttendanceRecord.date is
// `@db.Date` (no timezone). A local-time TODAY here would silently agree
// with a local-time bug in the service under test (both wrong the same way)
// and never catch it — this is the fixture that would have caught the
// 2026-07-26 timezone bug if it had been written this way from the start.
const TODAY = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

describe("DashboardService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
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

  async function makeSchool(suffix: string): Promise<{ schoolId: string; ownerId: string }> {
    const signed = await auth.signupOwner(
      {
        schoolName: `Dash ${suffix} ${runId}`,
        schoolSlug: `dash-${suffix}-${runId}`,
        ownerFirstName: "Bisi",
        ownerLastName: "Admin",
        ownerEmail: `dash-${suffix}-${runId}@example.test`,
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

  it("aggregates enrollment, fees, attendance, outstanding, collection-by-group, alerts, and the trend for a populated school", async () => {
    const svc = new DashboardService(makeFinanceService());
    const { schoolId, ownerId } = await makeSchool("full");

    const scenario = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-dash-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const previousTerm = await db.term.create({
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
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 2,
          name: "Second Term",
          startDate: new Date("2026-01-05"),
          endDate: new Date("2026-04-01"),
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

      // One student enrolled last term only (counts toward previousTermCount,
      // not the current term's enrolled count).
      const oldStudent = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-DASH-OLD-${runId}`,
          firstName: "Old",
          lastName: "Student",
          dateOfBirth: new Date("2011-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          schoolId,
          studentId: oldStudent.id,
          termId: previousTerm.id,
          academicYearId: year.id,
          classArmId: arm.id,
        },
      });

      // Two students enrolled THIS term.
      const s1 = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-DASH-1-${runId}`,
          firstName: "First",
          lastName: "Student",
          dateOfBirth: new Date("2011-01-01"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      const s2 = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-DASH-2-${runId}`,
          firstName: "Second",
          lastName: "Student",
          dateOfBirth: new Date("2011-01-01"),
          gender: "MALE",
        },
        select: { id: true },
      });
      for (const studentId of [s1.id, s2.id]) {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId,
            termId: term.id,
            academicYearId: year.id,
            classArmId: arm.id,
          },
        });
      }

      // Invoices this term: one fully paid, one overdue (past dueDate, still ISSUED).
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);

      await db.invoice.create({
        data: {
          schoolId,
          studentId: s1.id,
          termId: term.id,
          academicYearId: year.id,
          status: "PAID",
          items: [],
          totalAmount: 100_000,
          totalDiscount: 0,
          totalDue: 100_000,
          totalPaid: 100_000,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
      });
      await db.invoice.create({
        data: {
          schoolId,
          studentId: s2.id,
          termId: term.id,
          academicYearId: year.id,
          status: "OVERDUE",
          items: [],
          totalAmount: 50_000,
          totalDiscount: 0,
          totalDue: 50_000,
          totalPaid: 0,
          dueDate: yesterday,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
      });

      // Attendance today: one present, one absent.
      await db.attendanceRecord.create({
        data: {
          schoolId,
          studentId: s1.id,
          classArmId: arm.id,
          termId: term.id,
          date: TODAY,
          status: "PRESENT",
          markedBy: ownerId,
        },
      });
      await db.attendanceRecord.create({
        data: {
          schoolId,
          studentId: s2.id,
          classArmId: arm.id,
          termId: term.id,
          date: TODAY,
          status: "ABSENT",
          markedBy: ownerId,
        },
      });

      // A report card sitting FORM_REVIEWED — needs principal approval.
      await db.reportCard.create({
        data: {
          schoolId,
          studentId: s1.id,
          termId: term.id,
          academicYearId: year.id,
          classArmId: arm.id,
          status: "FORM_REVIEWED",
        },
      });

      // A pending (unaccepted, unexpired) staff invitation.
      const future = new Date();
      future.setDate(future.getDate() + 7);
      await db.invitation.create({
        data: {
          schoolId,
          email: `pending-${runId}@example.test`,
          roleKey: "teacher",
          tokenHash: `tok-${runId}-${Math.random().toString(36).slice(2)}`,
          invitedBy: ownerId,
          expiresAt: future,
        },
      });

      return { termId: term.id, classLevelId: level.id };
    });

    const dto = await svc.getAdminDashboard(ctx(schoolId, ownerId), scenario.termId);

    expect(dto.termName).toBe("Second Term");
    expect(dto.enrolled.count).toBe(2);
    expect(dto.enrolled.previousTermCount).toBe(1);

    expect(dto.fees.billed).toBe(150_000);
    expect(dto.fees.collected).toBe(100_000);
    expect(dto.fees.percent).toBe(67); // round(100000/150000*100)

    expect(dto.attendanceToday.presentCount).toBe(1);
    expect(dto.attendanceToday.absentCount).toBe(1);
    expect(dto.attendanceToday.totalMarked).toBe(2);
    expect(dto.attendanceToday.percentPresent).toBe(50);

    expect(dto.outstanding.amount).toBe(50_000);
    expect(dto.outstanding.debtorCount).toBe(1);

    expect(dto.collectionByGroup).toHaveLength(1);
    expect(dto.collectionByGroup[0]).toMatchObject({
      groupId: scenario.classLevelId,
      label: "JSS 1",
      billed: 150_000,
      collected: 100_000,
      percent: 67,
    });

    const overdueAlert = dto.needsYouToday.find((a) => a.type === "overdue_fees");
    expect(overdueAlert?.count).toBe(1);
    const reportCardAlert = dto.needsYouToday.find(
      (a) => a.type === "pending_report_card_approval",
    );
    expect(reportCardAlert?.count).toBe(1);
    const invitationAlert = dto.needsYouToday.find(
      (a) => a.type === "pending_staff_invitations",
    );
    expect(invitationAlert?.count).toBe(1);

    expect(dto.attendanceTrend.length).toBe(8);
    const lastWeek = dto.attendanceTrend[dto.attendanceTrend.length - 1]!;
    expect(lastWeek.percentPresent).toBe(50);
  });

  it("returns zeroed KPIs and no previousTermCount for a school with no data yet", async () => {
    const svc = new DashboardService(makeFinanceService());
    const { schoolId, ownerId } = await makeSchool("empty");

    const termId = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `2025/2026-dash-empty-${runId}`,
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
      return term.id;
    });

    const dto = await svc.getAdminDashboard(ctx(schoolId, ownerId), termId);

    expect(dto.enrolled).toEqual({ count: 0, previousTermCount: null });
    expect(dto.fees).toEqual({ collected: 0, billed: 0, percent: 0 });
    expect(dto.attendanceToday).toMatchObject({ presentCount: 0, absentCount: 0, percentPresent: 0 });
    expect(dto.outstanding).toEqual({ amount: 0, debtorCount: 0 });
    expect(dto.collectionByGroup).toEqual([]);
    expect(dto.needsYouToday.every((a) => a.count === 0)).toBe(true);
  });

  it("throws NotFoundError for an unknown termId", async () => {
    const svc = new DashboardService(makeFinanceService());
    const { schoolId, ownerId } = await makeSchool("no-term");

    await expect(
      svc.getAdminDashboard(ctx(schoolId, ownerId), "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});
