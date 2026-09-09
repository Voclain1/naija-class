import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { EmailService } from "../../common/email/email.service.js";
import type { TermiiService } from "../../common/termii/termii.service.js";
import type { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";
import type { NotificationDispatchService } from "../notifications/notification-dispatch.service.js";
import { AuthService } from "../auth/auth.service.js";
import { FinanceService } from "./finance.service.js";

// The finance dashboard's collection-by-class-level breakdown.
//
// The point of these tests is not that the numbers are computed — the admin
// dashboard already proved that — but that the SECOND caller of the shared
// builder behaves identically to the first. The specific failure being
// guarded against is a regression that shipped once already: invoices whose
// student has no ENROLLED row were silently dropped, so the rows did not sum
// to the totals shown directly above them. Porting the breakdown to a second
// screen is exactly the moment that fix gets left behind.

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
  return `+23488${(phoneCounter % 100).toString().padStart(2, "0")}${r}`;
}

describe("FinanceService.getCollectionByLevel (integration)", () => {
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

  const ctx = (schoolId: string, userId: string) => ({ sessionId: "sess", userId, schoolId });

  let seq = 0;
  async function makeSchool(): Promise<{ schoolId: string; ownerId: string }> {
    seq += 1;
    const suffix = `${runId}-${seq}`;
    const signed = await auth.signupOwner(
      {
        schoolName: `Cbl ${suffix}`,
        schoolSlug: `cbl-${suffix}`,
        ownerFirstName: "Uche",
        ownerLastName: "Bursar",
        ownerEmail: `cbl-${suffix}@example.test`,
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

  /** Two class levels, so ordering by orderIndex is actually exercised. */
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
      // Created out of order on purpose: JSS 2 first, JSS 1 second.
      const jss2 = await db.classLevel.create({
        data: { schoolId, name: "JSS 2", code: `jss2-${tag}`, stage: "JSS", orderIndex: 8 },
        select: { id: true },
      });
      const jss1 = await db.classLevel.create({
        data: { schoolId, name: "JSS 1", code: `jss1-${tag}`, stage: "JSS", orderIndex: 7 },
        select: { id: true },
      });
      const arm2 = await db.classArm.create({
        data: { schoolId, classLevelId: jss2.id, name: "JSS 2A", code: `j2a-${tag}` },
        select: { id: true },
      });
      const arm1 = await db.classArm.create({
        data: { schoolId, classLevelId: jss1.id, name: "JSS 1A", code: `j1a-${tag}` },
        select: { id: true },
      });
      return { yearId: year.id, termId: term.id, arm1: arm1.id, arm2: arm2.id };
    });
  }

  let studentSeq = 0;
  async function addStudent(
    schoolId: string,
    ownerId: string,
    sc: { yearId: string; termId: string },
    opts: { armId?: string; totalDue: number; totalPaid: number },
  ) {
    studentSeq += 1;
    return withTenant(schoolId, async (db) => {
      const st = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-CBL-${runId}-${studentSeq}`,
          firstName: "Kemi",
          lastName: `Test${studentSeq}`,
          dateOfBirth: new Date(Date.UTC(2012, 0, 1)),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      if (opts.armId) {
        await db.enrollment.create({
          data: {
            schoolId,
            studentId: st.id,
            termId: sc.termId,
            academicYearId: sc.yearId,
            classArmId: opts.armId,
          },
        });
      }
      await db.invoice.create({
        data: {
          schoolId,
          studentId: st.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          status: "ISSUED",
          items: [],
          totalAmount: opts.totalDue,
          totalDiscount: 0,
          totalDue: opts.totalDue,
          totalPaid: opts.totalPaid,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
      });
      return st.id;
    });
  }

  it("returns per-level rows ordered by orderIndex, not creation order", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    await addStudent(schoolId, ownerId, sc, { armId: sc.arm2, totalDue: 200_000, totalPaid: 50_000 });
    await addStudent(schoolId, ownerId, sc, { armId: sc.arm1, totalDue: 100_000, totalPaid: 100_000 });

    const res = await finance.getCollectionByLevel(ctx(schoolId, ownerId), sc.termId);

    expect(res.groups.map((g) => g.label)).toEqual(["JSS 1", "JSS 2"]);
    const jss1 = res.groups[0]!;
    expect(jss1.billed).toBe(100_000);
    expect(jss1.collected).toBe(100_000);
    expect(jss1.percent).toBe(100);
    expect(res.groups[1]!.percent).toBe(25); // 50k of 200k
  });

  it("carries the Unassigned bucket, so the rows SUM to the dashboard totals", async () => {
    // The regression this whole spec exists for: porting the breakdown to a
    // second screen without the #278 fix would drop this invoice, and the
    // rows would quietly stop matching the KPI tiles beside them.
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    await addStudent(schoolId, ownerId, sc, { armId: sc.arm1, totalDue: 300_000, totalPaid: 120_000 });
    await addStudent(schoolId, ownerId, sc, { totalDue: 200_000, totalPaid: 80_000 }); // no enrollment

    const res = await finance.getCollectionByLevel(ctx(schoolId, ownerId), sc.termId);

    const unassigned = res.groups.find((g) => g.groupId === "unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned!.label).toBe("Unassigned");
    expect(unassigned!.billed).toBe(200_000);
    expect(unassigned!.collected).toBe(80_000);
    // Sorted last, after every real level.
    expect(res.groups.at(-1)!.groupId).toBe("unassigned");

    expect(res.groups.reduce((t, g) => t + g.billed, 0)).toBe(res.totalInvoiced);
    expect(res.groups.reduce((t, g) => t + g.collected, 0)).toBe(res.totalCollected);
  });

  it("excludes DRAFT and CANCELLED invoices, matching the totals it must sum to", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    await addStudent(schoolId, ownerId, sc, { armId: sc.arm1, totalDue: 100_000, totalPaid: 40_000 });

    await withTenant(schoolId, async (db) => {
      const st = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `ADM-CBL-${runId}-cancelled`,
          firstName: "Void",
          lastName: "Invoice",
          dateOfBirth: new Date(Date.UTC(2012, 0, 1)),
          gender: "MALE",
        },
        select: { id: true },
      });
      await db.enrollment.create({
        data: {
          schoolId,
          studentId: st.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          classArmId: sc.arm1,
        },
      });
      await db.invoice.create({
        data: {
          schoolId,
          studentId: st.id,
          termId: sc.termId,
          academicYearId: sc.yearId,
          status: "CANCELLED",
          items: [],
          totalAmount: 999_000,
          totalDiscount: 0,
          totalDue: 999_000,
          totalPaid: 999_000,
          issuedAt: new Date(),
          issuedBy: ownerId,
        },
      });
    });

    const res = await finance.getCollectionByLevel(ctx(schoolId, ownerId), sc.termId);
    expect(res.groups.reduce((t, g) => t + g.billed, 0)).toBe(res.totalInvoiced);
    expect(res.totalInvoiced).toBe(100_000);
  });

  it("returns an empty array for a term with no invoices, not a zero row", async () => {
    const { schoolId, ownerId } = await makeSchool();
    const sc = await makeScaffold(schoolId);
    const res = await finance.getCollectionByLevel(ctx(schoolId, ownerId), sc.termId);
    expect(res.groups).toEqual([]);
  });
});
