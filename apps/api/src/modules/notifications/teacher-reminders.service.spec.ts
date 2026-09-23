import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AuthService } from "../auth/auth.service";
import { EventNotifierService } from "./event-notifier.service";
import { TeacherRemindersService } from "./teacher-reminders.service";

// The two teacher reminders (docs/modules/notifications-v1.md N1, part 2),
// against real Postgres.
//
// What these are really testing is RESTRAINT: a reminder that fires on a
// public holiday, or twice in one day, or at a teacher who has already done
// the job, is how a school ends up switching notifications off — and then the
// ones that matter never arrive either.

const runId = Math.random().toString(36).slice(2, 8);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("TeacherRemindersService (integration)", () => {
  const schoolIds = new Set<string>();
  const sent: Array<{ userId: string; eventType: string; eventId: string }> = [];

  // The dispatch rail is stubbed: what it does with a notification is tested
  // in event-notification.spec.ts. What matters here is WHO ends up in it.
  const dispatch = {
    notifyOfEvent: vi.fn(async (req: { principal: { userId?: string }; eventType: string; eventId: string }) => {
      sent.push({ userId: req.principal.userId ?? "?", eventType: req.eventType, eventId: req.eventId });
      return "PUSH" as const;
    }),
  };
  const calendar = {
    // No holidays unless a test adds one: each test states its own calendar.
    buildCalendar: vi.fn(async () => [] as never[]),
  };

  let A: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    otherTeacherId: string;
    armWithRegister: string;
    armWithout: string;
    termId: string;
  };

  const service = () =>
    new TeacherRemindersService(new EventNotifierService(dispatch as never, calendar as never));

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Reminders ${runId}`,
        schoolSlug: `reminders-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `reminders-${runId}@example.test`,
        ownerPhone: `+23499${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5, schoolWeekDays: [1, 2, 3, 4, 5] },
    });

    A = await withTenant(signed.school.id, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: signed.school.id, label: `2026/27-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: {
          schoolId: signed.school.id,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: day("2026-09-01"),
          endDate: day("2026-12-11"),
          isCurrent: true,
        },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId: signed.school.id }, orderBy: { orderIndex: "asc" } });
      const teacher = await db.user.create({
        data: { schoolId: signed.school.id, email: `t1-${runId}@example.test`, firstName: "Tunde", lastName: "Teacher" },
        select: { id: true },
      });
      const other = await db.user.create({
        data: { schoolId: signed.school.id, email: `t2-${runId}@example.test`, firstName: "Ngozi", lastName: "Teacher" },
        select: { id: true },
      });
      const armWithout = await db.classArm.create({
        data: { schoolId: signed.school.id, classLevelId: level.id, name: "JSS1A", code: `a-${runId}`, classTeacherId: teacher.id },
        select: { id: true },
      });
      const armWithRegister = await db.classArm.create({
        data: { schoolId: signed.school.id, classLevelId: level.id, name: "JSS1B", code: `b-${runId}`, classTeacherId: other.id },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId: signed.school.id,
          admissionNumber: `ADM-${runId}`,
          firstName: "Ada",
          lastName: "Pupil",
          dateOfBirth: day("2013-01-01"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      // Only the SECOND arm's register is taken today.
      await db.attendanceRecord.create({
        data: {
          schoolId: signed.school.id,
          studentId: student.id,
          classArmId: armWithRegister.id,
          termId: term.id,
          date: day("2026-09-23"),
          status: "PRESENT",
          markedBy: signed.user.id,
        },
      });
      return {
        schoolId: signed.school.id,
        ownerId: signed.user.id,
        teacherId: teacher.id,
        otherTeacherId: other.id,
        armWithRegister: armWithRegister.id,
        armWithout: armWithout.id,
        termId: term.id,
      };
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("chases the teacher whose register is missing, and nobody else", async () => {
    sent.length = 0;
    await service().remindAboutRegisters([A.schoolId], "2026-09-23"); // a Wednesday

    expect(sent.map((s) => s.userId)).toEqual([A.teacherId]);
    expect(sent[0]).toMatchObject({ eventType: "register.not-taken", eventId: "2026-09-23" });
    // The teacher who took theirs hears nothing.
    expect(sent.map((s) => s.userId)).not.toContain(A.otherTeacherId);
  });

  it("says nothing on a Saturday", async () => {
    sent.length = 0;
    await service().remindAboutRegisters([A.schoolId], "2026-09-26");
    expect(sent).toHaveLength(0);
  });

  it("says nothing on a public holiday, using the school's own calendar", async () => {
    sent.length = 0;
    calendar.buildCalendar.mockResolvedValueOnce([
      {
        id: "national:x",
        source: "NATIONAL",
        title: "Independence Day",
        category: "PUBLIC_HOLIDAY",
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        dateConfirmed: true,
        description: null,
      },
    ] as never);
    await service().remindAboutRegisters([A.schoolId], "2026-10-01"); // a Thursday
    expect(sent).toHaveLength(0);
  });

  it("says nothing outside the current term", async () => {
    sent.length = 0;
    await service().remindAboutRegisters([A.schoolId], "2026-12-23"); // after term end
    expect(sent).toHaveLength(0);
  });

  it("tells a teacher about unentered marks exactly one week before the term ends", async () => {
    sent.length = 0;
    await withTenant(A.schoolId, async (db) => {
      const subject = await db.subject.create({
        data: { schoolId: A.schoolId, name: `Maths ${runId}`, code: `m-${runId}` },
        select: { id: true },
      });
      await db.teacherAssignment.create({
        data: {
          schoolId: A.schoolId,
          teacherId: A.teacherId,
          classArmId: A.armWithout,
          subjectId: subject.id,
          academicYearId: (await db.term.findUniqueOrThrow({ where: { id: A.termId }, select: { academicYearId: true } })).academicYearId,
          termId: A.termId,
        },
      });
    });

    // Term ends 2026-12-11; seven days before is the 4th.
    await service().remindAboutMarks([A.schoolId], "2026-12-04");
    expect(sent.map((s) => s.userId)).toEqual([A.teacherId]);
    expect(sent[0]).toMatchObject({ eventType: "marks.not-entered", eventId: A.termId });
  });

  it("says nothing on any other day — it is a deadline reminder, not a daily nag", async () => {
    sent.length = 0;
    await service().remindAboutMarks([A.schoolId], "2026-12-03");
    await service().remindAboutMarks([A.schoolId], "2026-12-05");
    await service().remindAboutMarks([A.schoolId], "2026-11-01");
    expect(sent).toHaveLength(0);
  });

  it("one school's failure does not stop the sweep", async () => {
    sent.length = 0;
    const events = {
      registersNotTaken: vi
        .fn()
        .mockRejectedValueOnce(new Error("database gone"))
        .mockResolvedValue(undefined),
    };
    const reminders = new TeacherRemindersService(events as never);
    // Two ids, the first of which throws: the second must still be attempted.
    await reminders.remindAboutRegisters([A.schoolId, A.schoolId], "2026-09-23");
    expect(events.registersNotTaken).toHaveBeenCalledTimes(1);
  });
});
