import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthService } from "../auth/auth.service";
import { CalendarService } from "../calendar/calendar.service";
import { AnalyticsService, mondayOf, splitRanking, weekStarts } from "./analytics.service";
import { CompletenessService } from "./completeness.service";

// Phase 9 / CP1.2 — the analytics tabs against a REAL Postgres
// (docs/modules/phase-9.md §8.5). Every expected number is counted by hand
// from the fixture below and written next to it.
//
// TERMS: "Spring" 5 Jan – 27 Mar 2026 (previous), "Summer" Mon 13 Apr – 17 Jul
// 2026 (current). "Today" is pinned to Fri 24 Apr, so the counted days are the
// 10 weekdays 13–24 Apr: two weeks, w/c 13 Apr and w/c 20 Apr.
//
// CLASSES (one level): Blue — s1, s2, s3; Red — s4.
//
// RESULTS, Summer:  s1 RELEASED avg 80.00 (Maths 90, English 70)
//                   s2 RELEASED avg 60.00 (Maths 70, English 50)
//                   s3 DRAFT    avg 99.00 (Maths 99)   ← must count nowhere
//          Spring:  s1 RELEASED 70.00, s2 RELEASED 50.00 (Blue)
//   ⇒ Blue average (80+60)/2 = 70.00 from 2 students; Spring 60.00; change +10.00.
//   ⇒ Maths cell (90+70)/2 = 80.00 (n 2); English (70+50)/2 = 60.00 (n 2).
//
// ATTENDANCE, Blue (records every weekday, so no missing registers):
//   week 13 Apr: s1 5P, s2 5P, s3 3P 1L 1A        → 14 of 15 → 93.33
//   week 20 Apr: s1 5P, s2 4P 1A, s3 2P 3A        → 11 of 15 → 73.33
//   term 25 of 30 → 83.33
//   s2 9 of 10 = 90.00 — EXACTLY the 90% line, so NOT listed.
//   s3 6 of 10 = 60.00, 4 absent — listed.
// Red: s4 marked on Mon 13 Apr only → 9 school days with no register.
//
// ENROLMENT: Spring on roll s1, s2, s5, s6. Summer on roll s1, s2, s3, s4;
// s6 has a Summer row WITHDRAWN (not on roll). ⇒ 4 and 4; joiners s3, s4;
// leavers s5 "Not enrolled this term", s6 "Withdrawn".

let phone = 0;
const randomPhone = () =>
  `+23487${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("analytics helpers", () => {
  it("finds the Monday of a week, and every Monday across a range", () => {
    expect(mondayOf("2026-04-13")).toBe("2026-04-13");
    expect(mondayOf("2026-04-19")).toBe("2026-04-13"); // Sunday
    expect(weekStarts("2026-04-15", "2026-04-24")).toEqual(["2026-04-13", "2026-04-20"]);
    expect(weekStarts("2026-04-24", "2026-04-13")).toEqual([]);
  });

  it("never lists a student in both top and bottom", () => {
    const seven = [1, 2, 3, 4, 5, 6, 7];
    expect(splitRanking(seven, 5)).toEqual({ top: [1, 2, 3, 4, 5], bottom: [7, 6] });
    expect(splitRanking([1, 2, 3], 5)).toEqual({ top: [1, 2, 3], bottom: [] });
    const twelve = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(splitRanking(twelve, 5)).toEqual({ top: [1, 2, 3, 4, 5], bottom: [12, 11, 10, 9, 8] });
  });
});

describe("AnalyticsService (Phase 9 CP1.2) — real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const schoolIds: string[] = [];
  const reqCtx = { ipAddress: "127.0.0.1" };
  const service = () => {
    const s = new AnalyticsService(new CompletenessService(new CalendarService()));
    s.todayFn = () => "2026-04-24";
    return s;
  };
  const F = {} as {
    owner: AuthContext;
    otherOwner: AuthContext;
    springId: string;
    summerId: string;
    blue: string;
    red: string;
    maths: string;
    english: string;
    s: string[];
  };

  async function createSchool(tag: string): Promise<AuthContext> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Analytics ${tag}`,
        schoolSlug: `ana-${tag}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `ana-${tag}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.push(signed.school.id);
    return { sessionId: "s", userId: signed.user.id, schoolId: signed.school.id };
  }

  beforeAll(async () => {
    F.owner = await createSchool("a");
    F.otherOwner = await createSchool("b");
    const schoolId = F.owner.schoolId;

    await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `ANA-${runId}`, startDate: d("2026-01-05"), endDate: d("2026-07-24") },
        select: { id: true },
      });
      const mkTerm = async (sequence: number, name: string, start: string, end: string, isCurrent: boolean) =>
        (await db.term.create({
          data: { schoolId, academicYearId: year.id, sequence, name, startDate: d(start), endDate: d(end), isCurrent },
          select: { id: true },
        })).id;
      F.springId = await mkTerm(2, "Spring Term", "2026-01-05", "2026-03-27", false);
      F.summerId = await mkTerm(3, "Summer Term", "2026-04-13", "2026-07-17", true);

      const level = await db.classLevel.findFirst({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
      const mkArm = async (name: string) =>
        (await db.classArm.create({ data: { schoolId, classLevelId: level!.id, name, code: `${name.toLowerCase()}-${runId}` }, select: { id: true } })).id;
      F.blue = await mkArm("Blue");
      F.red = await mkArm("Red");
      const mkSubject = async (name: string) =>
        (await db.subject.create({ data: { schoolId, name: `${name} ${runId}`, code: `${name.toLowerCase()}-${runId}` }, select: { id: true } })).id;
      F.maths = await mkSubject("Maths");
      F.english = await mkSubject("English");

      F.s = [];
      for (let n = 1; n <= 6; n++) {
        F.s.push(
          (await db.student.create({
            data: { schoolId, admissionNumber: `ANA-${runId}-${n}`, firstName: `S${n}`, lastName: "Test", dateOfBirth: d("2014-01-01"), gender: "MALE" },
            select: { id: true },
          })).id,
        );
      }
      const [s1, s2, s3, s4, s5, s6] = F.s as [string, string, string, string, string, string];

      const enrol = (studentId: string, termId: string, classArmId: string, status: "ENROLLED" | "WITHDRAWN" | "PROMOTED" = "ENROLLED") =>
        db.enrollment.create({ data: { schoolId, studentId, termId, academicYearId: year.id, classArmId, status } });
      for (const st of [s1, s2, s5, s6]) await enrol(st, F.springId, F.blue, "PROMOTED");
      for (const st of [s1, s2, s3]) await enrol(st, F.summerId, F.blue);
      await enrol(s4, F.summerId, F.red);
      await enrol(s6, F.summerId, F.blue, "WITHDRAWN");

      const card = (studentId: string, termId: string, status: "RELEASED" | "DRAFT", overallAverage: number) =>
        db.reportCard.create({ data: { schoolId, studentId, termId, academicYearId: year.id, classArmId: F.blue, status, overallAverage } });
      await card(s1, F.summerId, "RELEASED", 8000);
      await card(s2, F.summerId, "RELEASED", 6000);
      await card(s3, F.summerId, "DRAFT", 9900);
      await card(s1, F.springId, "RELEASED", 7000);
      await card(s2, F.springId, "RELEASED", 5000);

      const mark = (studentId: string, subjectId: string, totalScore: number) =>
        db.assessment.create({
          data: { schoolId, studentId, subjectId, termId: F.summerId, academicYearId: year.id, classArmId: F.blue, totalScore, computedAt: new Date() },
        });
      await mark(s1, F.maths, 90);
      await mark(s2, F.maths, 70);
      await mark(s3, F.maths, 99);
      await mark(s1, F.english, 70);
      await mark(s2, F.english, 50);

      const week1 = ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17"];
      const week2 = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];
      const plan: Array<[string, string, Array<"PRESENT" | "LATE" | "ABSENT">]> = [
        [s1, F.blue, ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT"]],
        [s2, F.blue, ["PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "PRESENT", "ABSENT"]],
        [s3, F.blue, ["PRESENT", "PRESENT", "PRESENT", "LATE", "ABSENT", "PRESENT", "PRESENT", "ABSENT", "ABSENT", "ABSENT"]],
      ];
      const days = [...week1, ...week2];
      for (const [studentId, classArmId, statuses] of plan) {
        for (let i = 0; i < days.length; i++) {
          await db.attendanceRecord.create({
            data: { schoolId, studentId, classArmId, termId: F.summerId, date: d(days[i]!), status: statuses[i]!, markedBy: F.owner.userId },
          });
        }
      }
      await db.attendanceRecord.create({
        data: { schoolId, studentId: s4, classArmId: F.red, termId: F.summerId, date: d("2026-04-13"), status: "PRESENT", markedBy: F.owner.userId },
      });
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.$executeRaw`DELETE FROM schools WHERE id = ${id}`.catch(() => undefined);
  });

  it("academic: class averages count released cards only, with the change from last term", async () => {
    const r = await service().getAcademic(F.owner, undefined);
    expect(r.term?.id).toBe(F.summerId);
    expect(r.previousTerm?.id).toBe(F.springId);
    expect(r.classes).toEqual([
      {
        groupId: F.blue,
        label: "Blue",
        classLevelName: expect.any(String),
        releasedCount: 2,
        averageHundredths: 7000,
        previousAverageHundredths: 6000,
        changeHundredths: 1000,
      },
    ]);
  });

  it("academic: subject cells skip the student whose card is still a draft", async () => {
    const r = await service().getAcademic(F.owner, undefined);
    const cell = (subjectId: string) => r.cells.find((c) => c.subjectId === subjectId);
    expect(cell(F.maths)).toEqual({ groupId: F.blue, subjectId: F.maths, averageHundredths: 8000, studentCount: 2 });
    expect(cell(F.english)).toEqual({ groupId: F.blue, subjectId: F.english, averageHundredths: 6000, studentCount: 2 });
    expect(r.subjects.map((s) => s.subjectId).sort()).toEqual([F.maths, F.english].sort());
  });

  it("academic: rankings list released students only, best first, and no bottom list for a class of two", async () => {
    const r = await service().getAcademic(F.owner, undefined);
    expect(r.rankings).toHaveLength(1);
    expect(r.rankings[0]!.top.map((s) => [s.name, s.averageHundredths])).toEqual([
      ["S1 Test", 8000],
      ["S2 Test", 6000],
    ]);
    expect(r.rankings[0]!.bottom).toEqual([]);
  });

  it("academic: the first term has no previous term to compare with", async () => {
    const r = await service().getAcademic(F.owner, F.springId);
    expect(r.previousTerm).toBeNull();
    expect(r.classes[0]).toMatchObject({ averageHundredths: 6000, previousAverageHundredths: null, changeHundredths: null });
  });

  it("attendance: weekly rates per class, the term rate, and the threshold read from the school", async () => {
    const r = await service().getAttendance(F.owner, undefined);
    expect(r.thresholdPercent).toBe(90);
    expect(r.weeks).toEqual(["2026-04-13", "2026-04-20"]);
    const blue = r.classes.find((c) => c.groupId === F.blue)!;
    expect(blue.weeks).toEqual([
      { weekStart: "2026-04-13", rateHundredths: 9333, recordsMarked: 15 },
      { weekStart: "2026-04-20", rateHundredths: 7333, recordsMarked: 15 },
    ]);
    expect(blue.termRateHundredths).toBe(8333);
  });

  it("attendance: chronic absence lists students below the line, not at it", async () => {
    const r = await service().getAttendance(F.owner, undefined);
    expect(r.chronicAbsence).toEqual([
      {
        studentId: F.s[2],
        name: "S3 Test",
        admissionNumber: `ANA-${runId}-3`,
        classLabel: "Blue",
        daysMarked: 10,
        daysAbsent: 4,
        rateHundredths: 6000,
      },
    ]);
    // Raising the line to 95% brings in s2 (90.00).
    await withTenant(F.owner.schoolId, (db) => db.school.update({ where: { id: F.owner.schoolId }, data: { chronicAbsenceThreshold: 95 } }));
    try {
      const raised = await service().getAttendance(F.owner, undefined);
      expect(raised.thresholdPercent).toBe(95);
      expect(raised.chronicAbsence.map((s) => s.name)).toEqual(["S3 Test", "S2 Test"]);
    } finally {
      await withTenant(F.owner.schoolId, (db) => db.school.update({ where: { id: F.owner.schoolId }, data: { chronicAbsenceThreshold: 90 } }));
    }
  });

  it("attendance: days with no register match the Recording report's school days", async () => {
    const r = await service().getAttendance(F.owner, undefined);
    expect(r.missingRegisters).toEqual([
      {
        groupId: F.red,
        label: "Red",
        dates: ["2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"],
      },
    ]);
  });

  it("enrolment: counts on roll per level, joiners and leavers with plain reasons", async () => {
    const r = await service().getEnrolment(F.owner, undefined);
    expect(r.totals).toEqual({ thisTerm: 4, previousTerm: 4 });
    expect(r.levels).toEqual([{ groupId: expect.any(String), label: expect.any(String), thisTerm: 4, previousTerm: 4 }]);
    expect(r.joiners.map((j) => [j.name, j.classLabel, j.reason])).toEqual([
      ["S3 Test", "Blue", "New this term"],
      ["S4 Test", "Red", "New this term"],
    ]);
    expect(r.leavers.map((l) => [l.name, l.reason])).toEqual([
      ["S5 Test", "Not enrolled this term"],
      ["S6 Test", "Withdrawn"],
    ]);
  });

  it("teacher trend: the chosen term and those before it, oldest first, audited once", async () => {
    const audits = () =>
      withTenant(F.owner.schoolId, (db) => db.auditLog.count({ where: { action: "reports.teacher-activity.view" } }));
    const before = await audits();
    const r = await service().getTeacherTrend(F.owner, undefined, reqCtx);
    expect(r.terms.map((t) => t.id)).toEqual([F.springId, F.summerId]);
    expect(r.rows).toEqual([]); // no one holds the teacher role in this school
    expect(await audits()).toBe(before + 1);
  });

  it("teacher trend: a form teacher's registers for each term, and nothing for a term their class had no one enrolled", async () => {
    const schoolId = F.owner.schoolId;
    const teacherId = await withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId, firstName: "Tolu", lastName: "Teacher", email: `ana-t-${runId}@example.test`, phone: randomPhone(), passwordHash: "x" },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { schoolId: null, key: "teacher", isSystem: true }, select: { id: true } });
      await db.userRole.create({ data: { userId: u.id, roleId: role!.id } });
      await db.classArm.update({ where: { id: F.blue }, data: { classTeacherId: u.id } });
      return u.id;
    });
    try {
      const r = await service().getTeacherTrend(F.owner, undefined, reqCtx);
      const row = r.rows.find((x) => x.userId === teacherId)!;
      expect(row.name).toBe("Tolu Teacher");
      // Spring: Blue's rows there are PROMOTED, so no one was ENROLLED and nothing was owed.
      expect(row.terms[0]).toBeNull();
      // Summer: Blue registered on all 10 counted school days; no subjects assigned.
      expect(row.terms[1]).toEqual({
        termId: F.summerId,
        formRegistersTaken: 10,
        formRegistersExpected: 10,
        scoresEntered: 0,
        scoresExpected: 0,
      });
    } finally {
      await withTenant(schoolId, (db) => db.classArm.update({ where: { id: F.blue }, data: { classTeacherId: null } }));
    }
  });

  it("another school's term is not found, and that school sees none of these figures", async () => {
    await expect(service().getAcademic(F.otherOwner, F.summerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service().getAttendance(F.otherOwner, F.summerId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service().getEnrolment(F.otherOwner, F.summerId)).rejects.toBeInstanceOf(NotFoundError);
    const own = await service().getAcademic(F.otherOwner, undefined);
    expect(own.classes).toEqual([]);
  });
});
