import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service.js";
import { DashboardService } from "./dashboard.service.js";

// School profile card — every value proved against real Postgres rows.
//
// The point of this card is that nothing on it is decorative: each ratio has a
// denominator that comes from actual rows, each timestamp is the max of a real
// column, and each setup blocker corresponds to a precondition that genuinely
// breaks the app when unmet. These tests exist to keep it that way — if a
// value here could pass without the underlying rows existing, it would be the
// green-dot failure this card was designed to avoid.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const r = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23487${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

const TODAY = new Date(
  Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()),
);

describe("DashboardService school profile card (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const auth = new AuthService();
  const svc = new DashboardService();
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
        schoolName: `Prof ${suffix}`,
        schoolSlug: `prof-${suffix}`,
        ownerFirstName: "Amaka",
        ownerLastName: "Owner",
        ownerEmail: `prof-${suffix}@example.test`,
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

  /**
   * Year + current term + one level + `arms` arms.
   *
   * IMPORTANT: `AuthService.signupOwner` seeds a DEFAULT CLASS STRUCTURE —
   * a fresh school arrives with 14 class arms already created. Discovered by
   * this spec failing with `total: 14` on a school where the fixture had
   * created none. Every pre-existing arm is deactivated here so each test
   * controls its own denominator; asserting against 14 + n would silently
   * break the day the seed changes.
   */
  async function makeScaffold(schoolId: string, opts: { arms?: number; yearIsCurrent?: boolean } = {}) {
    seq += 1;
    const tag = `${runId}-${seq}`;
    const armCount = opts.arms ?? 1;
    await withTenant(schoolId, async (db) => {
      await db.classArm.updateMany({ data: { isActive: false } });
    });
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${tag}`,
          startDate: new Date(Date.UTC(2026, 0, 1)),
          endDate: new Date(Date.UTC(2026, 11, 31)),
          isCurrent: opts.yearIsCurrent ?? true,
        },
        select: { id: true, label: true },
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
      const arms: string[] = [];
      for (let i = 0; i < armCount; i++) {
        const arm = await db.classArm.create({
          data: {
            schoolId,
            classLevelId: level.id,
            name: `JSS 1${String.fromCharCode(65 + i)}`,
            code: `jss1${i}-${tag}`,
          },
          select: { id: true },
        });
        arms.push(arm.id);
      }
      return { yearId: year.id, yearLabel: year.label, termId: term.id, levelId: level.id, arms };
    });
  }

  let studentSeq = 0;
  async function makeStudent(schoolId: string) {
    studentSeq += 1;
    return withTenant(schoolId, async (db) =>
      db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-PROF-${runId}-${studentSeq}`,
          firstName: "Ife",
          lastName: `Test${studentSeq}`,
          dateOfBirth: new Date(Date.UTC(2012, 0, 1)),
          gender: "FEMALE",
        },
        select: { id: true },
      }),
    );
  }

  // ─── Facts ────────────────────────────────────────────────────────────────

  it("reports the CURRENT year and term, staff count and active class count from real rows", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId, { arms: 3 });

    await withTenant(schoolId, async (db) => {
      // One extra active arm and one DEACTIVATED arm — only active ones count.
      await db.classArm.update({ where: { id: sc.arms[2]! }, data: { isActive: false } });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    const p = res.schoolProfile;

    expect(p.academicYear?.label).toBe(sc.yearLabel);
    expect(p.term?.name).toBe("First Term");
    expect(p.term?.startDate).toBe("2026-01-05");
    expect(p.term?.endDate).toBe("2026-04-01");
    // signupOwner creates exactly one active user (the owner).
    expect(p.staffCount).toBe(1);
    expect(p.activeClassCount).toBe(2); // third arm deactivated
  });

  it("counts only ACTIVE staff", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);

    await withTenant(schoolId, async (db) => {
      await db.user.create({
        data: {
          schoolId,
          firstName: "Deactivated",
          lastName: "Teacher",
          email: `deact-${runId}-${seq}@example.test`,
          isActive: false,
        },
      });
      await db.user.create({
        data: {
          schoolId,
          firstName: "Active",
          lastName: "Teacher",
          email: `act-${runId}-${seq}@example.test`,
          isActive: true,
        },
      });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.staffCount).toBe(2); // owner + active teacher, not the deactivated one
  });

  // ─── Completeness ratios ──────────────────────────────────────────────────

  it("attendance-today ratio counts DISTINCT arms marked, over active arms", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId, { arms: 3 });
    const s1 = await makeStudent(schoolId);
    const s2 = await makeStudent(schoolId);

    await withTenant(schoolId, async (db) => {
      // Two students in the SAME arm — the ratio must count the arm once.
      for (const sid of [s1.id, s2.id]) {
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: sid,
            classArmId: sc.arms[0]!,
            termId: sc.termId,
            date: TODAY,
            status: "PRESENT",
            markedBy: ownerId,
          },
        });
      }
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.completeness.attendanceToday).toEqual({ done: 1, total: 3 });
  });

  it("attendance-today ratio ignores registers from other days", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId, { arms: 2 });
    const s1 = await makeStudent(schoolId);

    await withTenant(schoolId, async (db) => {
      await db.attendanceRecord.create({
        data: {
          schoolId,
          studentId: s1.id,
          classArmId: sc.arms[0]!,
          termId: sc.termId,
          date: new Date(TODAY.getTime() - 24 * 60 * 60 * 1000), // yesterday
          status: "PRESENT",
          markedBy: ownerId,
        },
      });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.completeness.attendanceToday).toEqual({ done: 0, total: 2 });
  });

  it("students-invoiced ratio is invoices over enrolled, for the CURRENT term", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    const s1 = await makeStudent(schoolId);
    const s2 = await makeStudent(schoolId);

    await withTenant(schoolId, async (db) => {
      for (const sid of [s1.id, s2.id]) {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: sid,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: sc.arms[0]!,
          },
        });
      }
      // Only one of the two has an invoice.
      await db.invoice.create({
        data: {
          schoolId,
          studentId: s1.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          status: "ISSUED",
          items: [],
          totalAmount: 100_000,
          totalDiscount: 0,
          totalDue: 100_000,
          totalPaid: 0,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
      });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.completeness.studentsInvoiced).toEqual({ done: 1, total: 2 });
  });

  it("reports a zero denominator rather than a fabricated percentage", async () => {
    // Nobody enrolled, no arms marked. The frontend renders "—" for these;
    // what matters is the API never implies 0% or 100% of nothing.
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId, { arms: 0 });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.completeness.attendanceToday).toEqual({ done: 0, total: 0 });
    expect(res.schoolProfile.completeness.studentsInvoiced).toEqual({ done: 0, total: 0 });
  });

  // ─── Last activity ────────────────────────────────────────────────────────

  it("last-activity timestamps are null until something is actually recorded", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.lastActivity.attendanceMarkedAt).toBeNull();
    expect(res.schoolProfile.lastActivity.paymentRecordedAt).toBeNull();
  });

  it("last-activity timestamps come from real rows once they exist", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    const s1 = await makeStudent(schoolId);
    const paidAt = new Date(Date.UTC(2026, 1, 3, 10, 30));

    await withTenant(schoolId, async (db) => {
      await db.attendanceRecord.create({
        data: {
          schoolId,
          studentId: s1.id,
          classArmId: sc.arms[0]!,
          termId: sc.termId,
          date: TODAY,
          status: "PRESENT",
          markedBy: ownerId,
        },
      });
      const inv = await db.invoice.create({
        data: {
          schoolId,
          studentId: s1.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          status: "ISSUED",
          items: [],
          totalAmount: 100_000,
          totalDiscount: 0,
          totalDue: 100_000,
          totalPaid: 100_000,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      await db.payment.create({
        data: {
          schoolId,
          invoiceId: inv.id,
          studentId: s1.id,
          amount: 100_000,
          method: "CASH",
          status: "SUCCESS",
          paidAt,
          recordedBy: ownerId,
        },
      });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.lastActivity.attendanceMarkedAt).not.toBeNull();
    expect(res.schoolProfile.lastActivity.paymentRecordedAt).toBe(paidAt.toISOString());
  });

  it("ignores REVERSED payments when reporting the last payment recorded", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    const s1 = await makeStudent(schoolId);

    await withTenant(schoolId, async (db) => {
      const inv = await db.invoice.create({
        data: {
          schoolId,
          studentId: s1.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          status: "ISSUED",
          items: [],
          totalAmount: 100_000,
          totalDiscount: 0,
          totalDue: 100_000,
          totalPaid: 0,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
        select: { id: true },
      });
      await db.payment.create({
        data: {
          schoolId,
          invoiceId: inv.id,
          studentId: s1.id,
          amount: 100_000,
          method: "CASH",
          status: "REVERSED",
          paidAt: new Date(Date.UTC(2026, 1, 3, 10, 30)),
          recordedBy: ownerId,
        },
      });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    // A refunded payment is not "activity" that says money is coming in.
    expect(res.schoolProfile.lastActivity.paymentRecordedAt).toBeNull();
  });

  // ─── Setup blockers ───────────────────────────────────────────────────────

  it("flags no_current_term when no term carries isCurrent", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    await withTenant(schoolId, async (db) => {
      await db.term.update({ where: { id: sc.termId }, data: { isCurrent: false } });
    });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    const p = res.schoolProfile;

    expect(p.setupBlockers.map((b) => b.type)).toContain("no_current_term");
    expect(p.term).toBeNull();
    expect(p.academicYear).toBeNull();
    // The ratio has nothing to be complete about, and says so honestly.
    expect(p.completeness.studentsInvoiced).toEqual({ done: 0, total: 0 });
  });

  it("flags no_current_academic_year when the current term's year is not flagged current", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId, { yearIsCurrent: false });

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.setupBlockers.map((b) => b.type)).toContain(
      "no_current_academic_year",
    );
  });

  it("flags no_fee_structure when no active fee item applies to the current term", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);

    const before = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(before.schoolProfile.setupBlockers.map((b) => b.type)).toContain("no_fee_structure");

    await withTenant(schoolId, async (db) => {
      const cat = await db.feeCategory.create({
        data: { schoolId, name: `Tuition ${runId}-${seq}`, createdBy: ownerId },
        select: { id: true },
      });
      // termId null = applies to every term, which is how a school with one
      // global fee structure is modelled. It must satisfy the blocker.
      await db.feeItem.create({
        data: {
          schoolId,
          categoryId: cat.id,
          name: "Tuition",
          amount: 100_000,
          termId: null,
          active: true,
          createdBy: ownerId,
        },
      });
    });

    const after = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(after.schoolProfile.setupBlockers.map((b) => b.type)).not.toContain("no_fee_structure");
  });

  it("does not raise no_academic_year once a year exists, and a fresh school genuinely has none", async () => {
    // Honest note on coverage: the no_academic_year BRANCH cannot be reached
    // through getAdminDashboard today, because the endpoint requires a valid
    // termId and a term cannot exist without a year. It is reachable only if
    // this profile ever moves to an endpoint that does not take a term. What
    // IS asserted here is both halves of its precondition: a year present
    // means no blocker, and a freshly provisioned school really does start
    // with zero years — the known open root cause this card exists to name.
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);

    const res = await svc.getAdminDashboard(ctx(schoolId, ownerId), sc.termId);
    expect(res.schoolProfile.setupBlockers.map((b) => b.type)).not.toContain("no_academic_year");

    const fresh = await makeSchool();
    const yearCount = await withTenant(fresh.schoolId, async (db) => db.academicYear.count());
    expect(yearCount).toBe(0);
  });
});
