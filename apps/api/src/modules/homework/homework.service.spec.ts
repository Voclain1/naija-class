import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { HomeworkService } from "./homework.service";

// Homework (docs/modules/the-school-day.md Part B), against real Postgres.
//
// Two things carry the risk here and get the most tests:
//   B8 — a teacher may set work only for a class and subject they teach;
//   the family read — a parent must never reach another family's child, which
//   RLS cannot enforce (it knows school_id, not who may see whom).

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const isoIn = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

describe("HomeworkService (integration)", () => {
  const service = new HomeworkService();
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    otherTeacherId: string;
    armId: string;
    otherArmId: string;
    mathsId: string;
    englishId: string;
    studentId: string;
    guardianId: string;
    otherStudentId: string;
    otherGuardianId: string;
  };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Homework ${runId}`,
        schoolSlug: `homework-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `homework-${runId}@example.test`,
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
        data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `hw-a-${runId}` },
        select: { id: true },
      });
      const otherArm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `hw-b-${runId}` },
        select: { id: true },
      });
      const maths = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const english = await db.subject.create({
        data: { schoolId, name: `Extra ${runId}`, code: `EX-${runId}` },
        select: { id: true, name: true },
      });

      // Both need the teacher ROLE granted, not just a user row: the service's
      // first gate is assertUserActiveAndHasOneOf, and a user with no grants is
      // nobody. (Getting this wrong is what the first run of this spec did.)
      const teacherRole = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });
      const makeTeacher = async (email: string, firstName: string) => {
        const user = await db.user.create({
          data: { schoolId, email, firstName, lastName: "Teacher" },
          select: { id: true },
        });
        await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        return user;
      };
      const teacher = await makeTeacher(`hw-t-${runId}@example.test`, "Tunde");
      const otherTeacher = await makeTeacher(`hw-t2-${runId}@example.test`, "Ngozi");
      // Tunde teaches maths in JSS1A, and nothing else.
      await db.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: teacher.id,
          classArmId: arm.id,
          subjectId: maths.id,
          academicYearId: year.id,
          isActive: true,
        },
      });

      const makeChild = async (name: string, armId: string) => {
        const student = await db.student.create({
          data: {
            schoolId,
            admissionNumber: `HW-${name}-${runId}`,
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
        const guardian = await db.guardian.create({
          data: {
            schoolId,
            firstName: `${name}-parent`,
            lastName: "Parent",
            relationship: "MOTHER",
            phone: `0803${Math.floor(Math.random() * 1_000_000).toString().padStart(7, "0")}`,
          },
          select: { id: true },
        });
        await db.studentGuardian.create({
          data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true },
        });
        return { studentId: student.id, guardianId: guardian.id };
      };

      const mine = await makeChild("Ada", arm.id);
      const theirs = await makeChild("Bola", otherArm.id);

      return {
        schoolId,
        ownerId: signed.user.id,
        teacherId: teacher.id,
        otherTeacherId: otherTeacher.id,
        armId: arm.id,
        otherArmId: otherArm.id,
        mathsId: maths.id,
        englishId: english.id,
        studentId: mine.studentId,
        guardianId: mine.guardianId,
        otherStudentId: theirs.studentId,
        otherGuardianId: theirs.guardianId,
      };
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const post = (userId: string, over: Record<string, unknown> = {}) =>
    service.create(
      ctx(A.schoolId, userId),
      {
        classArmId: A.armId,
        subjectId: A.mathsId,
        title: "Exercise 4",
        instructions: "Questions 1 to 10.",
        dueDate: isoIn(2),
        ...over,
      } as never,
      reqCtx,
    );

  describe("B8 — a teacher is held to what they teach", () => {
    it("lets a teacher set work for their own class and subject", async () => {
      const hw = await post(A.teacherId);
      expect(hw.className).toBe("JSS1A");
      expect(hw.subjectName).toBeTruthy();
      expect(hw.withdrawnAt).toBeNull();
      // The date comes back as a plain calendar date, not a timestamp.
      expect(hw.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("refuses a class the teacher does not teach", async () => {
      await expect(post(A.teacherId, { classArmId: A.otherArmId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses a subject the teacher does not teach in that class", async () => {
      await expect(post(A.teacherId, { subjectId: A.englishId })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("refuses a teacher with no assignments at all", async () => {
      await expect(post(A.otherTeacherId)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("lets an owner post for any class, as they may enter marks for any", async () => {
      const hw = await post(A.ownerId, { classArmId: A.otherArmId, subjectId: A.englishId, title: "Owner set this" });
      expect(hw.className).toBe("JSS1B");
    });

    it("refuses a class or subject that does not exist", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";
      await expect(post(A.ownerId, { classArmId: missing })).rejects.toBeInstanceOf(NotFoundError);
      await expect(post(A.ownerId, { subjectId: missing })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("the staff list", () => {
    it("shows a teacher their own by default, not the school's", async () => {
      const mine = await service.list(ctx(A.schoolId, A.teacherId), {});
      expect(mine.data.length).toBeGreaterThan(0);
      expect(mine.data.every((h) => h.className === "JSS1A")).toBe(true);
    });

    it("refuses ?all=true for a teacher rather than quietly narrowing it", async () => {
      // Silently returning their own would look like the school had set
      // nothing, which is worse than being told no.
      await expect(service.list(ctx(A.schoolId, A.teacherId), { all: true })).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("gives an owner every class with ?all=true", async () => {
      const all = await service.list(ctx(A.schoolId, A.ownerId), { all: true });
      expect(new Set(all.data.map((h) => h.className))).toEqual(new Set(["JSS1A", "JSS1B"]));
    });
  });

  describe("B10 — withdrawn, never deleted", () => {
    it("stops showing to the family but stays on the school's own list", async () => {
      const hw = await post(A.teacherId, { title: "Cancelled trip worksheet" });
      await service.withdraw(ctx(A.schoolId, A.teacherId), hw.id, reqCtx);

      const family = await service.forStudentSelf(A.schoolId, A.studentId);
      expect(family.data.map((h) => h.id)).not.toContain(hw.id);

      const staff = await service.list(ctx(A.schoolId, A.teacherId), {});
      expect(staff.data.find((h) => h.id === hw.id)?.withdrawnAt).not.toBeNull();
    });

    it("cannot be withdrawn twice", async () => {
      const hw = await post(A.teacherId, { title: "Twice" });
      await service.withdraw(ctx(A.schoolId, A.teacherId), hw.id, reqCtx);
      await expect(service.withdraw(ctx(A.schoolId, A.teacherId), hw.id, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    });

    it("cannot be withdrawn by a teacher who did not set it", async () => {
      const hw = await post(A.ownerId, { title: "Owner's own" });
      await expect(service.withdraw(ctx(A.schoolId, A.teacherId), hw.id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("can be withdrawn by an admin, who is who a parent complains to", async () => {
      const hw = await post(A.teacherId, { title: "Admin removes this" });
      const out = await service.withdraw(ctx(A.schoolId, A.ownerId), hw.id, reqCtx);
      expect(out.withdrawnAt).not.toBeNull();
    });
  });

  describe("what a family sees", () => {
    it("gives a student their own class's work, with the server deciding overdue", async () => {
      const due = await post(A.teacherId, { title: "Due tomorrow", dueDate: isoIn(1) });
      const late = await post(A.teacherId, { title: "Was due yesterday", dueDate: isoIn(-1) });

      const feed = await service.forStudentSelf(A.schoolId, A.studentId);
      const ids = feed.data.map((h) => h.id);
      expect(ids).toContain(due.id);
      // Yesterday's work still shows: a child who forgot it needs to see it.
      expect(ids).toContain(late.id);
      expect(feed.data.find((h) => h.id === late.id)?.overdue).toBe(true);
      expect(feed.data.find((h) => h.id === due.id)?.overdue).toBe(false);
      expect(feed.dueSoonCount).toBeGreaterThan(0);
    });

    it("never shows another class's work", async () => {
      const other = await post(A.ownerId, { classArmId: A.otherArmId, subjectId: A.englishId, title: "JSS1B only" });
      const feed = await service.forStudentSelf(A.schoolId, A.studentId);
      expect(feed.data.map((h) => h.id)).not.toContain(other.id);
    });

    it("lets a parent read their own child", async () => {
      const feed = await service.forGuardianChild(
        { schoolId: A.schoolId, guardianId: A.guardianId },
        A.studentId,
      );
      expect(feed.data.length).toBeGreaterThan(0);
    });

    it("refuses a parent another family's child — RLS cannot do this one", async () => {
      // withGuardian is the whole defence here: the policy knows school_id and
      // nothing about which guardian may see which student.
      await expect(
        service.forGuardianChild({ schoolId: A.schoolId, guardianId: A.guardianId }, A.otherStudentId),
      ).rejects.toBeTruthy();
    });

    it("returns nothing, not an error, for a child with no current class", async () => {
      const orphan = await withTenant(A.schoolId, async (db) => {
        const student = await db.student.create({
          data: {
            schoolId: A.schoolId,
            admissionNumber: `HW-none-${runId}`,
            firstName: "Chidi",
            lastName: "Pupil",
            dateOfBirth: day("2013-01-01"),
            gender: "MALE",
          },
          select: { id: true },
        });
        return student.id;
      });
      // A read a parent opens, not an action they took — an error here would
      // be a bug report about a child between classes.
      await expect(service.forStudentSelf(A.schoolId, orphan)).resolves.toEqual({ data: [], dueSoonCount: 0 });
    });
  });

  describe("posting is audited", () => {
    it("records who set what, for which class", async () => {
      const hw = await post(A.teacherId, { title: "Audited" });
      const audit = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirstOrThrow({
          where: { action: "homework.create", entityId: hw.id },
          select: { userId: true, metadata: true },
        }),
      );
      expect(audit.userId).toBe(A.teacherId);
      expect(audit.metadata).toMatchObject({ classArmId: A.armId, subjectId: A.mathsId });
    });
  });
});
