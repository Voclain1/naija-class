import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type RequestHostelExeatInput } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { StudentChargeService } from "../finance/student-charge.service";
import type { NotificationRequest } from "../notifications/notification-dispatch.service";
import { exeatDecisionMessage, HostelExeatService } from "./hostel-exeat.service";
import { HostelService } from "./hostel.service";

// Phase 9 / CP6b.3 — exeats, a boarder's leave out (docs/modules/phase-9.md
// §15 CP6b-D6; owner's answer 5 in §15.8), against real Postgres. Statuses
// move only forward; only the child's own guardian asks or cancels; a refusal
// needs a note; parents are told of the decision; a child out past the time
// agreed shows as late; cancelling stops once the child has left. The
// notification rail and Termii are stand-ins that record what was sent.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const HOUR = 60 * 60 * 1000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

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
  sent: { to: string; message: string }[] = [];
  async sendSms(to: string, message: string) {
    this.sent.push({ to, message });
  }
}

interface Fixture {
  schoolId: string;
  adminId: string;
  bursarId: string;
  houseMasterId: string;
  otherTeacherId: string;
  yearId: string;
  termId: string;
  armId: string;
}

describe("HostelExeatService (integration)", () => {
  const dispatch = new FakeDispatch();
  const termii = new FakeTermii();
  const hostels = new HostelService(new StudentChargeService());
  const exeats = new HostelExeatService(dispatch as never, termii as never);
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;
  let n = 0;

  async function setUp(label: string): Promise<Fixture> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Exeat ${label} ${runId}`,
        schoolSlug: `exeat-${label}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `exeat-${label}-${runId}@example.test`,
        ownerPhone: `+23495${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "This Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `ex-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string, tag = key) => {
        const user = await db.user.create({ data: { schoolId, email: `ex-${label}-${tag}-${runId}@example.test`, firstName: tag, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      return {
        schoolId,
        adminId: await staff("admin"),
        bursarId: await staff("bursar"),
        houseMasterId: await staff("house_master"),
        otherTeacherId: await staff("teacher"),
        yearId: year.id,
        termId: term.id,
        armId: arm.id,
      };
    });
  }

  const admin = (f: Fixture) => ctx(f.schoolId, f.adminId);
  const hm = (f: Fixture) => ctx(f.schoolId, f.houseMasterId);

  /** A hostel kept by the fixture's House master, and a boarder in it with two guardians. */
  async function boarder(f: Fixture) {
    n += 1;
    const h = await hostels.createHostel(admin(f), { name: `House ${n}`, forGender: "GIRLS" }, reqCtx);
    const room = await hostels.createRoom(admin(f), h.id, { name: "Room 1", beds: 4 }, reqCtx);
    await hostels.setHouseMasters(admin(f), h.id, { userIds: [f.houseMasterId] }, reqCtx);
    const ids = await withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `EX-${n}-${runId}`, firstName: "Adaeze", lastName: `Boarder${n}`, dateOfBirth: day("2012-01-01"), gender: "FEMALE" },
      });
      await db.enrollment.create({ data: { schoolId: f.schoolId, studentId: s.id, termId: f.termId, academicYearId: f.yearId, classArmId: f.armId, status: "ENROLLED" } });
      const guardian = async (phone: string) => {
        const g = await db.guardian.create({ data: { schoolId: f.schoolId, firstName: "Ngozi", lastName: `Parent${n}`, relationship: "MOTHER", phone } });
        await db.studentGuardian.create({ data: { schoolId: f.schoolId, studentId: s.id, guardianId: g.id, isPrimary: true } });
        return g.id;
      };
      return { studentId: s.id, mother: await guardian("08031110000"), father: await guardian("08032220000") };
    });
    await hostels.placeStudent(admin(f), { studentId: ids.studentId, termId: f.termId, roomId: room.rooms[0]!.id }, reqCtx);
    return { hostelId: h.id, ...ids, g: (guardianId: string) => ({ sessionId: "s", schoolId: f.schoolId, guardianId }) };
  }

  const ask = (overrides: Partial<RequestHostelExeatInput> = {}): RequestHostelExeatInput => ({
    outAt: at(24),
    backBy: at(48),
    reason: "Family wedding",
    collectorName: "Chidi Okafor",
    collectorRelationship: "Uncle",
    collectorPhone: "08035550000",
    ...overrides,
  });

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  beforeEach(() => {
    dispatch.calls = [];
    termii.sent = [];
    dispatch.pushGuardians.clear();
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("a parent asks; the house master approves; the child leaves and comes back; each step forward only", async () => {
    const k = await boarder(A);
    const asked = await exeats.requestForGuardian(k.g(k.mother), k.studentId, ask(), reqCtx);
    expect(asked).toMatchObject({ status: "REQUESTED", canCancel: true, collector: { name: "Chidi Okafor", relationship: "Uncle", phone: "08035550000" } });

    const list = await exeats.list(hm(A), k.hostelId, { view: "open" });
    expect(list.map((e) => e.id)).toEqual([asked.id]);
    expect(list[0]!.requestedBy).toBe(`Parent: Ngozi Parent${n}`);

    // Not out before it is approved.
    await expect(exeats.left(hm(A), asked.id, {}, reqCtx)).rejects.toThrow("Approve the leave out before the child leaves.");

    const approved = await exeats.approve(hm(A), asked.id, {}, reqCtx);
    expect(approved).toMatchObject({ status: "APPROVED", decidedByName: "house_master Staff" });
    await expect(exeats.approve(hm(A), asked.id, {}, reqCtx)).rejects.toBeInstanceOf(ConflictError);

    const out = await exeats.left(hm(A), asked.id, { collectedBy: "Mrs Okafor (aunt), uncle could not come" }, reqCtx);
    expect(out).toMatchObject({ status: "OUT", collectedBy: "Mrs Okafor (aunt), uncle could not come", late: false });
    // Once out, the parent can no longer cancel.
    await expect(exeats.cancelForGuardian(k.g(k.mother), k.studentId, asked.id, reqCtx)).rejects.toThrow("The child has already left.");

    const back = await exeats.back(hm(A), asked.id, {}, reqCtx);
    expect(back).toMatchObject({ status: "BACK", returnedLate: false });
    await expect(exeats.back(hm(A), asked.id, {}, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    expect((await exeats.list(hm(A), k.hostelId, { view: "open" })).map((e) => e.id)).not.toContain(asked.id);
    expect((await exeats.list(hm(A), k.hostelId, { view: "past" })).map((e) => e.id)).toContain(asked.id);

    // Every step is audited.
    const actions = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { entityId: asked.id }, select: { action: true } }));
    expect(actions.map((a) => a.action).sort()).toEqual(
      ["hostel.exeat.approve", "hostel.exeat.back", "hostel.exeat.notice", "hostel.exeat.out", "hostel.exeat.request"].sort(),
    );
  });

  it("tells every linked guardian of the decision — push where the app reaches them, else SMS", async () => {
    const k = await boarder(A);
    dispatch.pushGuardians.add(k.mother);
    const asked = await exeats.requestForGuardian(k.g(k.father), k.studentId, ask(), reqCtx);
    await exeats.approve(hm(A), asked.id, {}, reqCtx);
    expect(dispatch.calls.map((c) => c.guardianId).sort()).toEqual([k.mother, k.father].sort());
    expect(dispatch.calls[0]!.data).toEqual({ kind: "hostel-exeat", studentId: k.studentId });
    expect(dispatch.calls[0]!.body).toMatch(/^Adaeze's leave out on .+ was approved\.$/);
    expect(termii.sent).toHaveLength(1);
    expect(termii.sent[0]!.to).toBe("2348032220000");
  });

  it("a refusal needs a note, which the parent reads in the app; the message says only that it was not approved", async () => {
    const k = await boarder(A);
    const asked = await exeats.requestForGuardian(k.g(k.mother), k.studentId, ask(), reqCtx);
    await expect(
      withTenant(A.schoolId, (db) => db.hostelExeat.update({ where: { id: asked.id }, data: { status: "REFUSED" } })),
    ).rejects.toThrow(); // the CHECK: a refusal says why
    const refused = await exeats.refuse(hm(A), asked.id, { note: "Mid-term tests that weekend" }, reqCtx);
    expect(refused).toMatchObject({ status: "REFUSED", decisionNote: "Mid-term tests that weekend" });
    expect(dispatch.calls[0]!.body).toMatch(/was not approved\. Open the app to see why\.$/);
    expect(dispatch.calls[0]!.body).not.toMatch(/Mid-term/);
    const seen = await exeats.listForGuardian(k.g(k.mother), k.studentId);
    expect(seen[0]).toMatchObject({ status: "REFUSED", decisionNote: "Mid-term tests that weekend", canCancel: false });
    // The parent's view names no member of staff.
    expect(JSON.stringify(seen)).not.toMatch(/house_master|Staff/);
  });

  it("shows a child out past the time agreed as late, and one who came back late as such", async () => {
    const k = await boarder(A);
    const asked = await exeats.requestForGuardian(k.g(k.mother), k.studentId, ask({ outAt: at(-2), backBy: at(1) }), reqCtx);
    await exeats.approve(hm(A), asked.id, {}, reqCtx);
    await exeats.left(hm(A), asked.id, { at: at(-2) }, reqCtx);
    await withTenant(A.schoolId, (db) => db.hostelExeat.update({ where: { id: asked.id }, data: { backBy: new Date(Date.now() - HOUR) } }));
    expect((await exeats.list(hm(A), k.hostelId, { view: "open" }))[0]).toMatchObject({ status: "OUT", late: true });
    expect((await exeats.listForGuardian(k.g(k.mother), k.studentId))[0]).toMatchObject({ late: true });
    const back = await exeats.back(hm(A), asked.id, {}, reqCtx);
    expect(back).toMatchObject({ late: false, returnedLate: true });
  });

  it("the parent may cancel while waiting or approved; overlapping requests are refused; times are checked", async () => {
    const k = await boarder(A);
    const first = await exeats.requestForGuardian(k.g(k.mother), k.studentId, ask(), reqCtx);
    await expect(exeats.requestForGuardian(k.g(k.father), k.studentId, ask({ outAt: at(30), backBy: at(60) }), reqCtx)).rejects.toThrow(
      "There is already a leave out for this child at that time.",
    );
    await exeats.approve(hm(A), first.id, {}, reqCtx);
    const cancelled = await exeats.cancelForGuardian(k.g(k.father), k.studentId, first.id, reqCtx);
    expect(cancelled).toMatchObject({ status: "CANCELLED", canCancel: false });
    // Cancelled frees the time.
    await exeats.requestForGuardian(k.g(k.father), k.studentId, ask({ outAt: at(30), backBy: at(60) }), reqCtx);

    await expect(exeats.requestForGuardian(k.g(k.mother), k.studentId, ask({ outAt: at(-48), backBy: at(-24) }), reqCtx)).rejects.toBeInstanceOf(ValidationError);
    await expect(exeats.requestForGuardian(k.g(k.mother), k.studentId, ask({ outAt: at(100), backBy: at(100 + 31 * 24) }), reqCtx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("only the child's own guardian asks or cancels, and only for a boarder", async () => {
    const k = await boarder(A);
    const other = await boarder(A);
    await expect(exeats.requestForGuardian(other.g(other.mother), k.studentId, ask(), reqCtx)).rejects.toThrow();
    const asked = await exeats.requestForGuardian(k.g(k.mother), k.studentId, ask(), reqCtx);
    await expect(exeats.cancelForGuardian(other.g(other.mother), k.studentId, asked.id, reqCtx)).rejects.toThrow();
    await expect(exeats.cancelForGuardian(other.g(other.mother), other.studentId, asked.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(exeats.listForGuardian({ sessionId: "s", schoolId: B.schoolId, guardianId: k.mother }, k.studentId)).rejects.toThrow();

    const dayPupil = await withTenant(A.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: A.schoolId, admissionNumber: `EX-day-${runId}`, firstName: "Day", lastName: "Pupil", dateOfBirth: day("2012-01-01"), gender: "FEMALE" },
      });
      await db.studentGuardian.create({ data: { schoolId: A.schoolId, studentId: s.id, guardianId: k.mother, isPrimary: false } });
      return s.id;
    });
    await expect(exeats.requestForGuardian(k.g(k.mother), dayPupil, ask(), reqCtx)).rejects.toThrow("Your child does not have a hostel bed this term.");
  });

  it("the school enters a request taken by phone; only the hostel's house master, owner and admin decide", async () => {
    const k = await boarder(A);
    const entered = await exeats.createForStaff(hm(A), k.hostelId, { studentId: k.studentId, ...ask() }, reqCtx);
    expect(entered).toMatchObject({ status: "REQUESTED", requestedBy: "School: house_master Staff" });
    await expect(exeats.approve(ctx(A.schoolId, A.otherTeacherId), entered.id, {}, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(exeats.approve(ctx(A.schoolId, A.bursarId), entered.id, {}, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(exeats.approve(admin(B), entered.id, {}, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(exeats.createForStaff(ctx(A.schoolId, A.otherTeacherId), k.hostelId, { studentId: k.studentId, ...ask() }, reqCtx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await exeats.approve(admin(A), entered.id, { note: "Agreed by phone with the mother" }, reqCtx)).toMatchObject({ status: "APPROVED" });
    // An approval can be withdrawn, with a note, before the child leaves.
    expect(await exeats.refuse(hm(A), entered.id, { note: "Exams moved to that day" }, reqCtx)).toMatchObject({ status: "REFUSED" });
  });

  it("words the decision message plainly", () => {
    expect(exeatDecisionMessage("Adaeze", { status: "APPROVED", outAt: "2026-10-18T09:00:00+01:00" })).toBe("Adaeze's leave out on 18 Oct 2026 was approved.");
  });
});
