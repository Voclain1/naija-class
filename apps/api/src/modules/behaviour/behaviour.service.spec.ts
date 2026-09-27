import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { BehaviourService } from "./behaviour.service";

// Behaviour records (docs/modules/the-school-day.md Part C), against real
// Postgres.
//
// This is the most sensitive thing a school writes about a child, so the tests
// are about WHO may touch it, not about the happy path: a teacher confined to
// children they teach, a colleague unable to withdraw someone else's judgement,
// and no family surface existing at all.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const TODAY = new Date().toISOString().slice(0, 10);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

describe("BehaviourService (integration)", () => {
  const service = new BehaviourService();
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    otherTeacherId: string;
    mine: string;
    notMine: string;
  };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Behaviour ${runId}`,
        schoolSlug: `behaviour-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `behaviour-${runId}@example.test`,
        ownerPhone: `+23499${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.add(signed.school.id);
    const schoolId = signed.school.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });

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
        data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `bh-a-${runId}` },
        select: { id: true },
      });
      const otherArm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `bh-b-${runId}` },
        select: { id: true },
      });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const teacherRole = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });

      const makeTeacher = async (email: string, firstName: string, armId: string | null) => {
        const user = await db.user.create({
          data: { schoolId, email, firstName, lastName: "Teacher" },
          select: { id: true },
        });
        await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        if (armId) {
          await db.teacherAssignment.create({
            data: {
              schoolId,
              teacherId: user.id,
              classArmId: armId,
              subjectId: subject.id,
              academicYearId: year.id,
              isActive: true,
            },
          });
        }
        return user.id;
      };

      const teacher = await makeTeacher(`bh-t-${runId}@example.test`, "Tunde", arm.id);
      // Teaches JSS1B — a real teacher at the school, with no connection to the
      // child in JSS1A.
      const otherTeacher = await makeTeacher(`bh-t2-${runId}@example.test`, "Ngozi", otherArm.id);

      const makeChild = async (name: string, armId: string) => {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `BH-${name}-${runId}`,
            firstName: name,
            lastName: "Pupil",
            dateOfBirth: day("2013-01-01"),
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
            classArmId: armId,
            status: "ENROLLED",
          },
        });
        return student.id;
      };

      return {
        schoolId,
        ownerId: signed.user.id,
        teacherId: teacher,
        otherTeacherId: otherTeacher,
        mine: await makeChild("Ada", arm.id),
        notMine: await makeChild("Bola", otherArm.id),
      };
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const record = (userId: string, over: Record<string, unknown> = {}) =>
    service.create(
      ctx(A.schoolId, userId),
      { studentId: A.mine, kind: "CONCERN", note: "Disrupted the lesson twice.", occurredOn: TODAY, ...over } as never,
      reqCtx,
    );

  describe("who may write one", () => {
    it("lets a teacher record for a child they teach", async () => {
      const row = await record(A.teacherId);
      expect(row.kind).toBe("CONCERN");
      expect(row.recordedByName).toBe("Tunde Teacher");
      expect(row.occurredOn).toBe(TODAY);
    });

    it("refuses a teacher for a child they do not teach", async () => {
      // A real teacher at the same school, with no connection to this child.
      await expect(record(A.otherTeacherId)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("lets an owner record for any child", async () => {
      const row = await record(A.ownerId, { studentId: A.notMine, kind: "COMMENDATION", note: "Helped a new pupil." });
      expect(row.kind).toBe("COMMENDATION");
    });

    it("refuses a student who does not exist", async () => {
      await expect(
        record(A.ownerId, { studentId: "00000000-0000-4000-8000-000000000000" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("records the day it HAPPENED, not the day it was written", async () => {
      // A teacher writes up Friday's incident on Monday, and a record that
      // quietly claims Monday is one nobody can rely on in a meeting.
      const row = await record(A.teacherId, { occurredOn: "2026-09-18" });
      expect(row.occurredOn).toBe("2026-09-18");
    });
  });

  describe("C16 — both kinds, and only live ones are counted", () => {
    it("counts commendations and concerns separately", async () => {
      await record(A.ownerId, { studentId: A.mine, kind: "COMMENDATION", note: "Excellent homework." });
      const list = await service.listForStudent(ctx(A.schoolId, A.ownerId), { studentId: A.mine }, reqCtx);
      expect(list.commendations).toBeGreaterThan(0);
      expect(list.concerns).toBeGreaterThan(0);
    });

    it("keeps a withdrawn record visible but out of the counts", async () => {
      const row = await record(A.teacherId, { note: "Withdraw me." });
      const before = await service.listForStudent(ctx(A.schoolId, A.ownerId), { studentId: A.mine }, reqCtx);
      await service.withdraw(ctx(A.schoolId, A.teacherId), row.id, reqCtx);
      const after = await service.listForStudent(ctx(A.schoolId, A.ownerId), { studentId: A.mine }, reqCtx);

      // Still there — "it was written and taken back" is part of the history.
      expect(after.data.map((r) => r.id)).toContain(row.id);
      expect(after.data.find((r) => r.id === row.id)?.withdrawnAt).not.toBeNull();
      // But not counted as a concern any more.
      expect(after.concerns).toBe(before.concerns - 1);
    });
  });

  describe("withdrawing is not editing someone else's judgement", () => {
    it("refuses a teacher withdrawing a colleague's record", async () => {
      const theirs = await record(A.ownerId, { note: "The head wrote this." });
      await expect(service.withdraw(ctx(A.schoolId, A.teacherId), theirs.id, reqCtx)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("lets an admin withdraw anyone's", async () => {
      const mine = await record(A.teacherId, { note: "Admin removes this." });
      const out = await service.withdraw(ctx(A.schoolId, A.ownerId), mine.id, reqCtx);
      expect(out.withdrawnAt).not.toBeNull();
    });

    it("cannot be withdrawn twice", async () => {
      const row = await record(A.teacherId, { note: "Once only." });
      await service.withdraw(ctx(A.schoolId, A.teacherId), row.id, reqCtx);
      await expect(service.withdraw(ctx(A.schoolId, A.teacherId), row.id, reqCtx)).rejects.toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe("who may read one", () => {
    it("refuses a teacher reading a child they do not teach", async () => {
      await expect(
        service.listForStudent(ctx(A.schoolId, A.otherTeacherId), { studentId: A.mine }, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("audits the READ, not only the write", async () => {
      // "Who has been looking at this child's record" is a question a school
      // may one day have to answer.
      await service.listForStudent(ctx(A.schoolId, A.ownerId), { studentId: A.mine }, reqCtx);
      const audit = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirstOrThrow({
          where: { action: "behaviour.read", entityId: A.mine },
          orderBy: { createdAt: "desc" },
          select: { userId: true },
        }),
      );
      expect(audit.userId).toBe(A.ownerId);
    });

    it("keeps the NOTE out of the audit log", async () => {
      const row = await record(A.teacherId, { note: "A sentence nobody should find twice." });
      const audit = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirstOrThrow({
          where: { action: "behaviour.create", entityId: row.id },
          select: { metadata: true },
        }),
      );
      // The log answers who wrote what KIND about whom. Repeating the text
      // would put the most sensitive sentence in the system in a second place
      // with a different retention.
      expect(JSON.stringify(audit.metadata)).not.toContain("nobody should find twice");
      expect(audit.metadata).toMatchObject({ kind: "CONCERN", studentId: A.mine });
    });
  });
});
