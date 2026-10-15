import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  createSickbayVisitSchema,
  formatSickbayTime,
  sickbayMomentFrom,
} from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import type { NotificationRequest } from "../notifications/notification-dispatch.service";
import { SICKBAY_PUSH_BODY, SickbayService, buildSickbaySms } from "./sickbay.service";

// Phase 9 / CP3.3 — the sickbay log and the parent notice
// (docs/modules/phase-9.md §10 CP3-D5, CP3-D6), against real Postgres.
//
// The notification rail and Termii are stand-ins that RECORD what they were
// asked to send, so each test can assert exactly what reached a parent, by
// which channel, and what it said.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const COMPLAINT = "Headache and a high temperature";
const ACTION = "Rested in the sickbay";
const MEDICINE = "Paracetamol";

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

class FakeDispatch {
  calls: NotificationRequest[] = [];
  pushGuardians = new Set<string>();
  async notifyGuardian(req: NotificationRequest) {
    this.calls.push(req);
    if (this.pushGuardians.has(req.guardianId)) return "PUSH" as const;
    return req.smsAvailable ? ("SMS" as const) : ("NONE" as const);
  }
}

class FakeTermii {
  isConfigured = true;
  sent: { to: string; message: string; sender?: string }[] = [];
  async sendSms(to: string, message: string, sender?: string) {
    this.sent.push({ to, message, sender });
  }
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Sickbay ${label} ${runId}`,
      schoolSlug: `sickbay-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `sickbay-${label}-${runId}@example.test`,
      ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

/** A moment `minutes` ago. */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe("SickbayService (integration)", () => {
  const dispatch = new FakeDispatch();
  const termii = new FakeTermii();
  const service = new SickbayService(dispatch as never, termii as never);
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    schoolName: string;
    ownerId: string;
    adminId: string;
    officerId: string;
    teacherId: string;
    bursarId: string;
    child: string;
    pushGuardian: string;
    smsGuardian: string;
    unlinkedGuardian: string;
  };
  let B: { schoolId: string; guardianId: string };

  const visit = (overrides: Partial<Parameters<typeof createSickbayVisitSchema.parse>[0]> = {}) =>
    createSickbayVisitSchema.parse({
      studentId: A.child,
      visitedAt: ago(30),
      complaint: COMPLAINT,
      actionTaken: ACTION,
      ...overrides,
    });

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS2A", code: `sb-a-${runId}` }, select: { id: true } });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (email: string, firstName: string, roleKey: string, armId: string | null) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Staff" }, select: { id: true } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(roleKey) } });
        if (armId) {
          await db.teacherAssignment.create({
            data: { schoolId, teacherId: user.id, classArmId: armId, subjectId: subject.id, academicYearId: year.id, isActive: true },
          });
        }
        return user.id;
      };
      const s = await db.student.create({
        data: { schoolId, admissionNumber: `SB-Ada-${runId}`, firstName: "Adaeze", lastName: "Pupil", dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" } });
      const guardian = async (firstName: string, phone: string) =>
        (await db.guardian.create({ data: { schoolId, firstName, lastName: "Parent", relationship: "MOTHER", phone }, select: { id: true } })).id;
      const pushGuardian = await guardian("Pushy", "08031112222");
      const smsGuardian = await guardian("Texty", "08037654321");
      await db.studentGuardian.create({ data: { schoolId, studentId: s.id, guardianId: pushGuardian, isPrimary: true } });
      await db.studentGuardian.create({ data: { schoolId, studentId: s.id, guardianId: smsGuardian, isPrimary: false } });
      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true } });
      return {
        schoolId,
        schoolName: school.name,
        ownerId: a.ownerId,
        adminId: await staff(`sb-ad-${runId}@example.test`, "Amaka", "admin", null),
        officerId: await staff(`sb-ho-${runId}@example.test`, "Halima", "health_officer", null),
        teacherId: await staff(`sb-t-${runId}@example.test`, "Tunde", "teacher", arm.id),
        bursarId: await staff(`sb-b-${runId}@example.test`, "Bisi", "bursar", null),
        child: s.id,
        pushGuardian,
        smsGuardian,
        unlinkedGuardian: await guardian("Unlinked", "08030000000"),
      };
    });
    dispatch.pushGuardians.add(A.pushGuardian);

    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = {
      schoolId: b.schoolId,
      guardianId: await withTenant(b.schoolId, async (db) =>
        (await db.guardian.create({ data: { schoolId: b.schoolId, firstName: "Far", lastName: "Away", relationship: "FATHER", phone: "08039999999" }, select: { id: true } })).id,
      ),
    };
  });

  beforeEach(() => {
    dispatch.calls = [];
    termii.sent = [];
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const guardianCtx = (schoolId: string, guardianId: string) => ({ sessionId: `g-${runId}`, schoolId, guardianId });

  describe("recording a visit", () => {
    it("the Health officer records a visit with medicine given", async () => {
      const visitedAt = ago(40);
      const dto = await service.createVisit(
        ctx(A.schoolId, A.officerId),
        visit({ visitedAt, medications: [{ name: MEDICINE, dose: "500 mg", givenAt: ago(35) }] }),
        reqCtx,
      );
      expect(dto).toMatchObject({
        studentName: "Adaeze Pupil",
        className: "JSS2A",
        complaint: COMPLAINT,
        actionTaken: ACTION,
        sentHome: false,
        shareWithParent: false,
        recordedByName: "Halima Staff",
        withdrawnAt: null,
      });
      expect(dto.medications).toHaveLength(1);
      expect(dto.medications[0]).toMatchObject({ name: MEDICINE, dose: "500 mg", givenByName: "Halima Staff" });
      const day = (await service.listVisits(ctx(A.schoolId, A.adminId), {}, reqCtx)).data;
      expect(day.map((v) => v.id)).toContain(dto.id);
    });

    it("refuses a visit in the future, and medicine before the visit", async () => {
      const officer = ctx(A.schoolId, A.officerId);
      const future = new Date(Date.now() + 60 * 60_000).toISOString();
      await expect(service.createVisit(officer, visit({ visitedAt: future }), reqCtx)).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.createVisit(officer, visit({ visitedAt: ago(10), medications: [{ name: MEDICINE, dose: "1", givenAt: ago(20) }] }), reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        service.createVisit(officer, visit({ visitedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString() }), reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("medicine can be added later, and a withdrawn visit is kept but closed", async () => {
      const officer = ctx(A.schoolId, A.officerId);
      const dto = await service.createVisit(officer, visit({ visitedAt: ago(60) }), reqCtx);
      const added = await service.addMedication(officer, dto.id, { name: MEDICINE, dose: "250 mg", givenAt: ago(5) }, reqCtx);
      expect(added.medications.map((m) => m.dose)).toEqual(["250 mg"]);
      const withdrawn = await service.withdrawVisit(officer, dto.id, reqCtx);
      expect(withdrawn.withdrawnAt).not.toBeNull();
      await expect(service.withdrawVisit(officer, dto.id, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      await expect(service.addMedication(officer, dto.id, { name: MEDICINE, dose: "1", givenAt: ago(1) }, reqCtx)).rejects.toBeInstanceOf(
        ConflictError,
      );
      const listed = (await service.listVisits(officer, { studentId: A.child }, reqCtx)).data.find((v) => v.id === dto.id)!;
      expect(listed.withdrawnAt).not.toBeNull();
    });

    it("a teacher and a bursar can neither record nor read the log", async () => {
      for (const userId of [A.teacherId, A.bursarId]) {
        await expect(service.createVisit(ctx(A.schoolId, userId), visit(), reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(service.listVisits(ctx(A.schoolId, userId), {}, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(service.listVisits(ctx(A.schoolId, userId), { studentId: A.child }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("another school's staff see none of these visits (RLS)", async () => {
      const b = await withTenant(B.schoolId, async (db) => {
        const owner = await db.user.findFirstOrThrow({ select: { id: true } });
        return owner.id;
      });
      const listed = await service.listVisits(ctx(B.schoolId, b), { studentId: A.child }, reqCtx);
      expect(listed.data).toHaveLength(0);
    });
  });

  describe("telling the parents", () => {
    it("an ordinary visit: push to the guardian with the app, and no SMS to anyone", async () => {
      const dto = await service.createVisit(ctx(A.schoolId, A.officerId), visit(), reqCtx);
      expect(dispatch.calls.map((c) => c.guardianId).sort()).toEqual([A.pushGuardian, A.smsGuardian].sort());
      for (const call of dispatch.calls) {
        expect(call.body).toBe(SICKBAY_PUSH_BODY);
        expect(call.title).toBe(A.schoolName);
        expect(call.smsAvailable).toBe(false);
        expect(JSON.stringify(call)).not.toMatch(/Adaeze|Headache/);
      }
      expect(termii.sent).toHaveLength(0);
      expect(dto.notices).toEqual({ push: 1, sms: 0, none: 1 });
    });

    it("sent home: an SMS to the guardian without the app, naming the time and no complaint", async () => {
      const visitedAt = ago(15);
      const dto = await service.createVisit(
        ctx(A.schoolId, A.officerId),
        visit({ visitedAt, sentHome: true, medications: [{ name: MEDICINE, dose: "500 mg", givenAt: ago(10) }] }),
        reqCtx,
      );
      expect(termii.sent).toHaveLength(1);
      expect(termii.sent[0]!.to).toBe("2348037654321");
      expect(termii.sent[0]!.message).toBe(
        `${A.schoolName}: Adaeze visited the sickbay at ${formatSickbayTime(visitedAt)} and is being sent home. Please contact the school.`,
      );
      expect(termii.sent[0]!.message).not.toMatch(/Headache|Paracetamol|500/);
      expect(dto.notices).toEqual({ push: 1, sms: 1, none: 0 });
    });

    it("once per guardian per visit, however often the notice runs", async () => {
      const dto = await service.createVisit(ctx(A.schoolId, A.officerId), visit({ sentHome: true }), reqCtx);
      dispatch.calls = [];
      termii.sent = [];
      await (service as unknown as { notifyGuardians: (...a: unknown[]) => Promise<void> }).notifyGuardians(
        ctx(A.schoolId, A.officerId),
        dto.id,
        reqCtx,
      );
      expect(dispatch.calls).toHaveLength(0);
      expect(termii.sent).toHaveLength(0);
    });

    it("the SMS text is fixed", () => {
      expect(buildSickbaySms({ schoolName: "Bright Future", studentFirstName: "Ada", visitedAt: new Date("2026-10-15T09:40:00Z") })).toBe(
        "Bright Future: Ada visited the sickbay at 10:40 and is being sent home. Please contact the school.",
      );
      expect(sickbayMomentFrom("2026-10-15", "10:40")).toBe("2026-10-15T09:40:00.000Z");
    });
  });

  describe("the parent's view", () => {
    it("without 'share details': the time and sent-home only; with it, the details too", async () => {
      const officer = ctx(A.schoolId, A.officerId);
      const kept = await service.createVisit(officer, visit({ visitedAt: ago(90) }), reqCtx);
      const shared = await service.createVisit(
        officer,
        visit({ visitedAt: ago(80), shareWithParent: true, sentHome: true, medications: [{ name: MEDICINE, dose: "500 mg", givenAt: ago(75) }] }),
        reqCtx,
      );
      const seen = (await service.visitsForGuardian(guardianCtx(A.schoolId, A.smsGuardian), A.child)).data;
      const keptRow = seen.find((v) => v.id === kept.id)!;
      expect(keptRow).toMatchObject({ sentHome: false, details: null });
      expect(JSON.stringify(keptRow)).not.toMatch(/Headache|Rested/);
      const sharedRow = seen.find((v) => v.id === shared.id)!;
      expect(sharedRow.sentHome).toBe(true);
      expect(sharedRow.details).toMatchObject({ complaint: COMPLAINT, actionTaken: ACTION });
      expect(sharedRow.details!.medications).toEqual([expect.objectContaining({ name: MEDICINE, dose: "500 mg" })]);
    });

    it("a withdrawn visit is gone for the parent", async () => {
      const officer = ctx(A.schoolId, A.officerId);
      const dto = await service.createVisit(officer, visit(), reqCtx);
      await service.withdrawVisit(officer, dto.id, reqCtx);
      const seen = (await service.visitsForGuardian(guardianCtx(A.schoolId, A.pushGuardian), A.child)).data;
      expect(seen.map((v) => v.id)).not.toContain(dto.id);
    });

    it("an unlinked guardian and another school's guardian get nothing", async () => {
      await expect(service.visitsForGuardian(guardianCtx(A.schoolId, A.unlinkedGuardian), A.child)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(service.visitsForGuardian(guardianCtx(B.schoolId, B.guardianId), A.child)).rejects.toThrow();
    });
  });

  it("every read and write is audited, and the audit log holds no health text", async () => {
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { action: { startsWith: "sickbay." } } }));
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set([
        "sickbay.visit.create",
        "sickbay.visit.withdraw",
        "sickbay.medication.add",
        "sickbay.read",
        "sickbay.portal.read",
        "sickbay.notice",
      ]),
    );
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/Headache|Rested|Paracetamol|500 mg|250 mg/i);
  });
});
