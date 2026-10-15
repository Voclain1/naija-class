import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, createDisciplineActionSchema, decideDisciplineActionSchema } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import type { NotificationRequest } from "../notifications/notification-dispatch.service";
import { DISCIPLINE_PUSH_BODY, DisciplineService, buildDisciplineSms } from "./discipline.service";

// Phase 9 / CP2.3 — discipline actions and parent notices
// (docs/modules/phase-9.md §9 CP2-D3, CP2-D4), against real Postgres.
//
// The notification rail and Termii are stand-ins that RECORD what they were
// asked to send, so each test can assert exactly what reached a parent, by
// which channel, and what it said.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const REASON = "Fought in the playground and hurt a younger pupil.";

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
      schoolName: `Discipline ${label} ${runId}`,
      schoolSlug: `discipline-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `discipline-${label}-${runId}@example.test`,
      ownerPhone: `+23498${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

describe("DisciplineService (integration)", () => {
  const dispatch = new FakeDispatch();
  const termii = new FakeTermii();
  const service = new DisciplineService(dispatch as never, termii as never);
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    ownerId: string;
    adminId: string;
    otherAdminId: string;
    teacherId: string;
    otherTeacherId: string;
    child: string;
    otherChild: string;
    pushGuardian: string;
    smsGuardian: string;
    unlinkedGuardian: string;
  };
  let B: { schoolId: string; guardianId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;

    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: day("2026-09-01"),
          endDate: day("2026-12-11"),
          isCurrent: true,
        },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `dc-a-${runId}` },
        select: { id: true },
      });
      const otherArm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `dc-b-${runId}` },
        select: { id: true },
      });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const role = async (key: string) =>
        (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;

      const makeStaff = async (email: string, firstName: string, roleKey: string, armId: string | null) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Staff" }, select: { id: true } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(roleKey) } });
        if (armId) {
          await db.teacherAssignment.create({
            data: { schoolId, teacherId: user.id, classArmId: armId, subjectId: subject.id, academicYearId: year.id, isActive: true },
          });
        }
        return user.id;
      };

      const makeChild = async (name: string, armId: string) => {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `DC-${name}-${runId}`,
            firstName: name,
            lastName: "Pupil",
            dateOfBirth: day("2013-01-01"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" },
        });
        return student.id;
      };
      const makeGuardian = async (firstName: string, phone: string) =>
        (
          await db.guardian.create({
            data: { schoolId, firstName, lastName: "Parent", relationship: "MOTHER", phone },
            select: { id: true },
          })
        ).id;

      const child = await makeChild("Adaeze", arm.id);
      const pushGuardian = await makeGuardian("Push", "08031234567");
      const smsGuardian = await makeGuardian("Sms", "08037654321");
      const unlinkedGuardian = await makeGuardian("Other", "08030000000");
      await db.studentGuardian.createMany({
        data: [
          { schoolId, studentId: child, guardianId: pushGuardian, isPrimary: true },
          { schoolId, studentId: child, guardianId: smsGuardian },
        ],
      });

      return {
        schoolId,
        ownerId: a.ownerId,
        adminId: await makeStaff(`dc-ad-${runId}@example.test`, "Amaka", "admin", null),
        otherAdminId: await makeStaff(`dc-ad2-${runId}@example.test`, "Bayo", "admin", null),
        teacherId: await makeStaff(`dc-t-${runId}@example.test`, "Tunde", "teacher", arm.id),
        otherTeacherId: await makeStaff(`dc-t2-${runId}@example.test`, "Ngozi", "teacher", otherArm.id),
        child,
        otherChild: await makeChild("Bola", otherArm.id),
        pushGuardian,
        smsGuardian,
        unlinkedGuardian,
      };
    });
    dispatch.pushGuardians.add(A.pushGuardian);

    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = {
      schoolId: b.schoolId,
      guardianId: await withTenant(b.schoolId, async (db) =>
        (
          await db.guardian.create({
            data: { schoolId: b.schoolId, firstName: "Far", lastName: "Away", relationship: "FATHER", phone: "08039999999" },
            select: { id: true },
          })
        ).id,
      ),
    };
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.disciplineNotice.deleteMany({});
        await db.disciplineAction.deleteMany({});
      }).catch(() => undefined);
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const reset = () => {
    dispatch.calls = [];
    termii.sent = [];
  };

  const suspension = { type: "SUSPENSION" as const, startOn: "2026-10-20", endOn: "2026-10-22", reason: REASON };

  const propose = (userId: string, over: Record<string, unknown> = {}) =>
    service.propose(ctx(A.schoolId, userId), { studentId: A.child, ...suspension, ...over } as never, reqCtx);

  describe("proposing", () => {
    it("a teacher proposes for a child they teach, and it waits", async () => {
      reset();
      const action = await propose(A.teacherId);
      expect(action.status).toBe("PROPOSED");
      expect(action.proposedByName).toBe("Tunde Staff");
      expect(action.canDecide).toBe(false);
      expect(action.canWithdraw).toBe(true);
      // A proposal tells no one.
      expect(dispatch.calls).toHaveLength(0);
      expect(termii.sent).toHaveLength(0);
    });

    it("refuses a teacher for a child they do not teach, and writes nothing", async () => {
      const before = await withTenant(A.schoolId, (db) => db.disciplineAction.count());
      await expect(propose(A.otherTeacherId)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await withTenant(A.schoolId, (db) => db.disciplineAction.count())).toBe(before);
    });

    it("the owner's own proposal is approved when made, recorded as theirs", async () => {
      reset();
      const action = await propose(A.ownerId, { type: "WARNING", startOn: undefined, endOn: undefined });
      expect(action.status).toBe("APPROVED");
      expect(action.proposedByName).toBe("Owen Owner");
      expect(action.decidedByName).toBe("Owen Owner");
      // A warning is never sent to a parent, even approved.
      expect(dispatch.calls).toHaveLength(0);
    });

    it("the dates must follow the type, in the DTO and in the database", async () => {
      expect(createDisciplineActionSchema.safeParse({ studentId: A.child, type: "SUSPENSION", startOn: "2026-10-22", endOn: "2026-10-20", reason: "x" }).success).toBe(false);
      expect(createDisciplineActionSchema.safeParse({ studentId: A.child, type: "WARNING", startOn: "2026-10-22", reason: "x" }).success).toBe(false);
      expect(createDisciplineActionSchema.safeParse({ studentId: A.child, type: "EXCLUSION", startOn: "2026-10-22", endOn: "2026-10-23", reason: "x" }).success).toBe(false);
      await expect(
        withTenant(A.schoolId, (db) =>
          db.disciplineAction.create({
            data: {
              schoolId: A.schoolId,
              studentId: A.child,
              type: "SUSPENSION",
              startOn: day("2026-10-22"),
              endOn: day("2026-10-20"),
              reason: "x",
              proposedBy: A.teacherId,
            },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("deciding", () => {
    it("a teacher cannot approve", async () => {
      const action = await propose(A.teacherId);
      await expect(
        service.decide(ctx(A.schoolId, A.teacherId), action.id, { decision: "APPROVE" }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("no admin decides their own proposal; another admin can", async () => {
      reset();
      const action = await propose(A.adminId);
      expect(action.status).toBe("PROPOSED");
      expect(action.canDecide).toBe(false);
      await expect(
        service.decide(ctx(A.schoolId, A.adminId), action.id, { decision: "APPROVE" }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const decided = await service.decide(ctx(A.schoolId, A.otherAdminId), action.id, { decision: "REJECT", reason: "Not enough." }, reqCtx);
      expect(decided.status).toBe("REJECTED");
      expect(decided.decisionReason).toBe("Not enough.");
      // A rejection tells no one.
      expect(dispatch.calls).toHaveLength(0);
    });

    it("a rejection needs a reason", () => {
      expect(decideDisciplineActionSchema.safeParse({ decision: "REJECT" }).success).toBe(false);
      expect(decideDisciplineActionSchema.safeParse({ decision: "APPROVE" }).success).toBe(true);
    });

    it("cannot be decided twice", async () => {
      const action = await propose(A.teacherId, { type: "DETENTION", endOn: undefined });
      await service.decide(ctx(A.schoolId, A.adminId), action.id, { decision: "APPROVE" }, reqCtx);
      await expect(
        service.decide(ctx(A.schoolId, A.otherAdminId), action.id, { decision: "APPROVE" }, reqCtx),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it("an approved detention tells no parent", async () => {
      reset();
      const action = await propose(A.teacherId, { type: "DETENTION", endOn: undefined });
      await service.decide(ctx(A.schoolId, A.adminId), action.id, { decision: "APPROVE" }, reqCtx);
      expect(dispatch.calls).toHaveLength(0);
      expect(termii.sent).toHaveLength(0);
    });
  });

  describe("the parent notice", () => {
    let approvedId: string;

    it("an approved suspension tells every guardian once: push if they have the app, SMS otherwise", async () => {
      reset();
      const action = await propose(A.teacherId);
      const decided = await service.decide(ctx(A.schoolId, A.adminId), action.id, { decision: "APPROVE" }, reqCtx);
      approvedId = decided.id;
      expect(decided.status).toBe("APPROVED");
      expect(decided.guardiansNotified).toBe(2);

      expect(dispatch.calls.map((c) => c.guardianId).sort()).toEqual([A.pushGuardian, A.smsGuardian].sort());
      // The locked-screen text names no child and no action.
      for (const call of dispatch.calls) {
        expect(call.body).toBe(DISCIPLINE_PUSH_BODY);
        expect(`${call.title} ${call.body}`).not.toMatch(/Adaeze|suspend|exclu/i);
        expect(JSON.stringify(call.data)).not.toMatch(/Adaeze/);
      }
      // SMS only to the guardian with no live app, and never the reason.
      expect(termii.sent).toHaveLength(1);
      expect(termii.sent[0]!.to).toBe("2348037654321");
      expect(termii.sent[0]!.message).toMatch(/Adaeze has been suspended from 20 Oct to 22 Oct 2026\. Please contact the school\.$/);
      expect(termii.sent[0]!.message).not.toContain("playground");
    });

    it("is sent once per guardian, even when the send is retried", async () => {
      reset();
      await (service as unknown as { notifyGuardians: (...a: unknown[]) => Promise<void> }).notifyGuardians(
        ctx(A.schoolId, A.adminId),
        approvedId,
        "SENT",
        reqCtx,
      );
      expect(dispatch.calls).toHaveLength(0);
      expect(termii.sent).toHaveLength(0);
      const rows = await withTenant(A.schoolId, (db) => db.disciplineNotice.findMany({ where: { actionId: approvedId } }));
      expect(rows.map((r) => `${r.kind}:${r.channel}`).sort()).toEqual(["SENT:PUSH", "SENT:SMS"]);
    });

    it("the parent route returns the action and dates only, never the reason, note or proposer", async () => {
      const res = await service.listNoticesForGuardian(
        { sessionId: "s", schoolId: A.schoolId, guardianId: A.smsGuardian },
        A.child,
      );
      const notice = res.data.find((n) => n.id === approvedId)!;
      expect(Object.keys(notice).sort()).toEqual(["decidedOn", "endOn", "id", "startOn", "type", "withdrawnOn"]);
      expect(notice).toMatchObject({ type: "SUSPENSION", startOn: "2026-10-20", endOn: "2026-10-22", withdrawnOn: null });
      // Proposals, rejections, warnings and detentions never appear.
      expect(res.data.every((n) => n.type === "SUSPENSION" || n.type === "EXCLUSION")).toBe(true);
      expect(JSON.stringify(res)).not.toMatch(/playground|Tunde|Amaka/);
    });

    it("withdrawing it sends one withdrawal notice to each guardian who was told", async () => {
      reset();
      const withdrawn = await service.withdraw(ctx(A.schoolId, A.adminId), approvedId, reqCtx);
      expect(withdrawn.status).toBe("WITHDRAWN");
      expect(dispatch.calls).toHaveLength(2);
      expect(termii.sent).toHaveLength(1);
      expect(termii.sent[0]!.message).toMatch(/: The notice of \d+ \w{3} \d{4} has been withdrawn\.$/);

      // A second withdrawal is refused, so nobody is told twice.
      reset();
      await expect(service.withdraw(ctx(A.schoolId, A.adminId), approvedId, reqCtx)).rejects.toBeInstanceOf(ConflictError);
      expect(dispatch.calls).toHaveLength(0);

      const res = await service.listNoticesForGuardian({ sessionId: "s", schoolId: A.schoolId, guardianId: A.pushGuardian }, A.child);
      expect(res.data.find((n) => n.id === approvedId)!.withdrawnOn).not.toBeNull();
    });

    it("withdrawing a proposal tells no one", async () => {
      reset();
      const action = await propose(A.teacherId, { type: "EXCLUSION", endOn: undefined });
      await service.withdraw(ctx(A.schoolId, A.teacherId), action.id, reqCtx);
      expect(dispatch.calls).toHaveLength(0);
    });

    it("an unlinked guardian, and another school's guardian, get nothing", async () => {
      await expect(
        service.listNoticesForGuardian({ sessionId: "s", schoolId: A.schoolId, guardianId: A.unlinkedGuardian }, A.child),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.listNoticesForGuardian({ sessionId: "s", schoolId: B.schoolId, guardianId: B.guardianId }, A.child),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // RLS: under school B's GUC, school A's actions do not exist.
      expect(await withTenant(B.schoolId, (db) => db.disciplineAction.count())).toBe(0);
    });

    it("the SMS wording for an exclusion", () => {
      expect(
        buildDisciplineSms({
          schoolName: "Bright Start",
          kind: "SENT",
          studentFirstName: "Ada",
          type: "EXCLUSION",
          startOn: "2026-10-20",
          endOn: null,
          decidedOn: "2026-10-16",
        }),
      ).toBe("Bright Start: Ada has been excluded from 20 Oct 2026. Please contact the school.");
    });
  });

  describe("withdrawing and reading", () => {
    it("a teacher withdraws only their own proposal", async () => {
      const action = await propose(A.adminId, { type: "WARNING", startOn: undefined, endOn: undefined });
      await expect(service.withdraw(ctx(A.schoolId, A.teacherId), action.id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("a teacher sees a taught child's actions, and otherwise only their own", async () => {
      const mine = await service.list(ctx(A.schoolId, A.teacherId), {}, reqCtx);
      expect(mine.data.length).toBeGreaterThan(0);
      expect(mine.data.every((a) => a.proposedByName === "Tunde Staff")).toBe(true);
      const child = await service.list(ctx(A.schoolId, A.teacherId), { studentId: A.child }, reqCtx);
      expect(child.data.some((a) => a.proposedByName !== "Tunde Staff")).toBe(true);
      await expect(
        service.list(ctx(A.schoolId, A.otherTeacherId), { studentId: A.child }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("the audit log holds the type and dates, never the reason", async () => {
      const rows = await withTenant(A.schoolId, (db) =>
        db.auditLog.findMany({ where: { action: { startsWith: "discipline." } } }),
      );
      expect(rows.map((r) => r.action)).toEqual(
        expect.arrayContaining(["discipline.propose", "discipline.decide", "discipline.withdraw", "discipline.notice", "discipline.read"]),
      );
      expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/playground|Not enough/);
    });
  });
});
