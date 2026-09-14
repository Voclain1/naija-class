import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { AuthService } from "../auth/auth.service";
import { CalendarService } from "../calendar/calendar.service";
import { CompletenessService } from "./completeness.service";
import { ReportsController } from "./reports.controller";

// Phase 8 / CP2 — Recording Completeness against a REAL Postgres.
// docs/modules/phase-8.md §16.5.
//
// The "expected" definitions are what make this report trustworthy or not, so
// every number asserted below is HAND-COUNTED from the fixture, with the count
// written next to it. Nothing is asserted as "greater than zero".
//
// THE FIXTURE CALENDAR — March 2026 (school A's "Spring Term", 2 Mar – 27 Mar):
//
//   Mon  Tue  Wed  Thu  Fri | Sat  Sun
//    2    3    4    5    6  |  7    8
//    9   10H  11   12B  13B | 14   15
//   16   17   18   19E  20E | 21   22
//   23   24   25   26   27  |
//
//   20 weekdays.
//   E  19–20  Eid-el-Fitr 2026, CONFIRMED national holiday (seeded)  → excluded
//   H  10     school HOLIDAY event                                    → excluded
//   B  12–13  school BREAK event                                      → excluded
//   school MEETING on Thu 5                                           → NOT excluded
//   ⇒ 20 − 2 − 1 − 2 = 15 school days per arm.
//
// "Today" is pinned (service.todayFn) so the expectation cannot drift daily.

let phone = 0;
const randomPhone = () =>
  `+23489${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function guardCtx(handler: (...args: any[]) => unknown, user: AuthContext): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => ReportsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("CompletenessService (Phase 8 CP2) — real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1" };
  const guard = new PermissionsGuard(new Reflector());
  const schoolIds: string[] = [];
  const service = () => {
    const s = new CompletenessService(new CalendarService());
    s.todayFn = () => "2026-03-31"; // term A ended 27 Mar; a later term exists
    return s;
  };

  async function createSchool(tag: string): Promise<{ schoolId: string; owner: AuthContext }> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Completeness ${tag}`,
        schoolSlug: `cmp-${tag}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cmp-${tag}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.push(signed.school.id);
    return { schoolId: signed.school.id, owner: { sessionId: "s", userId: signed.user.id, schoolId: signed.school.id } as AuthContext };
  }

  async function createStaff(schoolId: string, role: "teacher" | "bursar", first: string, last: string): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: first,
          lastName: last,
          email: `cmp-${first}-${runId}-${Math.random().toString(36).slice(2, 6)}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      const r = await db.role.findFirst({ where: { schoolId: null, key: role, isSystem: true }, select: { id: true } });
      await db.userRole.create({ data: { userId: u.id, roleId: r!.id } });
      return { sessionId: "s", userId: u.id, schoolId } as AuthContext;
    });
  }

  // ---------------------------------------------------------------------------
  // School A — the full fixture described in the header.
  // ---------------------------------------------------------------------------
  const A = {} as {
    schoolId: string;
    owner: AuthContext;
    t1: AuthContext; // form teacher of arm 1, assigned Maths (whole year) + English (this term)
    t2: AuthContext; // teacher, no assignments
    bursar: AuthContext;
    termId: string;
    otherTermId: string;
    arm1: { id: string; name: string };
    arm2: { id: string; name: string };
    arm3: { id: string; name: string };
    maths: string;
    english: string;
    science: string;
  };

  beforeAll(async () => {
    const s = await createSchool("a");
    Object.assign(A, s);
    A.t1 = await createStaff(A.schoolId, "teacher", "Tolu", "Adeyemi");
    A.t2 = await createStaff(A.schoolId, "teacher", "Bisi", "Okafor");
    A.bursar = await createStaff(A.schoolId, "bursar", "Ben", "Bursar");

    await withTenant(A.schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: A.schoolId, label: `CMP-${runId}`, startDate: d("2026-01-05"), endDate: d("2026-07-24") },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId: A.schoolId, academicYearId: year.id, sequence: 2, name: "Spring Term",
          startDate: d("2026-03-02"), endDate: d("2026-03-27"), isCurrent: true,
        },
        select: { id: true },
      });
      A.termId = term.id;
      // A LATER term that has not been made current (NEXT_TERM_NOT_CURRENT).
      const later = await db.term.create({
        data: {
          schoolId: A.schoolId, academicYearId: year.id, sequence: 3, name: "Summer Term",
          startDate: d("2026-04-20"), endDate: d("2026-07-24"),
        },
        select: { id: true },
      });
      A.otherTermId = later.id;

      const level = await db.classLevel.findFirst({ where: { schoolId: A.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
      const mkArm = async (name: string) =>
        db.classArm.create({ data: { schoolId: A.schoolId, classLevelId: level!.id, name, code: `${name.toLowerCase()}-${runId}` }, select: { id: true, name: true } });
      A.arm1 = await mkArm("Arm-One");
      A.arm2 = await mkArm("Arm-Two");
      A.arm3 = await mkArm("Arm-Three"); // no enrollments at all
      await db.classArm.update({ where: { id: A.arm1.id }, data: { classTeacherId: A.t1.userId } });

      const mkSubject = async (name: string) =>
        (await db.subject.create({ data: { schoolId: A.schoolId, name: `${name} ${runId}`, code: `${name.toLowerCase()}-${runId}` }, select: { id: true } })).id;
      A.maths = await mkSubject("Maths");
      A.english = await mkSubject("English");
      A.science = await mkSubject("Science");

      const mkStudent = async (n: number) =>
        (await db.student.create({
          data: { schoolId: A.schoolId, admissionNumber: `CMP-${runId}-${n}`, firstName: `S${n}`, lastName: "Test", dateOfBirth: d("2014-01-01"), gender: "FEMALE" },
          select: { id: true },
        })).id;
      const s1 = await mkStudent(1);
      const s2 = await mkStudent(2);
      const s3 = await mkStudent(3);
      const s4 = await mkStudent(4); // WITHDRAWN enrollment — must not count
      for (const [studentId, armId, status] of [
        [s1, A.arm1.id, "ENROLLED"],
        [s2, A.arm1.id, "ENROLLED"],
        [s3, A.arm2.id, "ENROLLED"],
        [s4, A.arm2.id, "WITHDRAWN"],
      ] as const) {
        await db.enrollment.create({ data: { schoolId: A.schoolId, studentId, termId: term.id, academicYearId: year.id, classArmId: armId, status } });
      }

      // Assignments (D35):
      //   T1  arm1 × Maths    whole year (termId null)   → effective
      //   T1  arm1 × English  this term                  → effective
      //   T1  arm2 × Maths    the LATER term only        → NOT effective this term
      //   T1  arm1 × Science  whole year but INACTIVE    → NOT effective
      await db.teacherAssignment.createMany({
        data: [
          { schoolId: A.schoolId, teacherId: A.t1.userId, classArmId: A.arm1.id, subjectId: A.maths, academicYearId: year.id, termId: null },
          { schoolId: A.schoolId, teacherId: A.t1.userId, classArmId: A.arm1.id, subjectId: A.english, academicYearId: year.id, termId: term.id },
          { schoolId: A.schoolId, teacherId: A.t1.userId, classArmId: A.arm2.id, subjectId: A.maths, academicYearId: year.id, termId: later.id },
          { schoolId: A.schoolId, teacherId: A.t1.userId, classArmId: A.arm1.id, subjectId: A.science, academicYearId: year.id, termId: null, isActive: false },
        ],
      });

      // Registers on arm 1 (two students each day, so a day must count ONCE):
      //   Mon 2 (T1), Tue 3 (T1), Mon 23 (owner)          → school days: 3
      //   Sat 7, Tue 10 (school holiday), Thu 19 (Eid)     → non-school days: 3
      //   Thu 5 (MEETING day — an ordinary school day)     → school day: +1 ⇒ 4
      // Arm 2: none. Arm 3 (no enrollment): one stray register — must not appear.
      const marks: Array<[string, string, string]> = [
        ["2026-03-02", A.t1.userId, A.arm1.id],
        ["2026-03-03", A.t1.userId, A.arm1.id],
        ["2026-03-05", A.owner.userId, A.arm1.id],
        ["2026-03-23", A.owner.userId, A.arm1.id],
        ["2026-03-07", A.owner.userId, A.arm1.id],
        ["2026-03-10", A.owner.userId, A.arm1.id],
        ["2026-03-19", A.owner.userId, A.arm1.id],
      ];
      for (const [date, by, arm] of marks) {
        for (const studentId of [s1, s2]) {
          await db.attendanceRecord.create({ data: { schoolId: A.schoolId, studentId, classArmId: arm, termId: term.id, date: d(date), status: "PRESENT", markedBy: by } });
        }
      }
      await db.attendanceRecord.create({ data: { schoolId: A.schoolId, studentId: s3, classArmId: A.arm3.id, termId: term.id, date: d("2026-03-04"), status: "PRESENT", markedBy: A.owner.userId } });
      // A register dated AFTER "today" (31 Mar is outside the term anyway) is never counted.

      // Scores (components seeded at signup: CA1, CA2, Exam = 3):
      //   s1 Maths   ×3 by T1       s2 Maths ×1 by owner   → arm1×Maths entered 4 of 2×3=6
      //   s1 English ×2 by T1                               → arm1×English entered 2 of 6
      //   s3 Science ×1 by owner (arm2×Science: no assignment) → "unassigned", 1
      //   s4 (WITHDRAWN) Maths ×1 — must not count anywhere
      const comps = await db.gradingComponent.findMany({ where: { schoolId: A.schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
      expect(comps).toHaveLength(3);
      const score = (studentId: string, subjectId: string, componentId: string, enteredBy: string) =>
        db.assessmentScore.create({ data: { schoolId: A.schoolId, studentId, subjectId, termId: term.id, componentId, score: 5, enteredBy } });
      for (const c of comps) await score(s1, A.maths, c.id, A.t1.userId);
      await score(s2, A.maths, comps[0].id, A.owner.userId);
      await score(s1, A.english, comps[0].id, A.t1.userId);
      await score(s1, A.english, comps[1].id, A.t1.userId);
      await score(s3, A.science, comps[0].id, A.owner.userId);
      await score(s4, A.maths, comps[0].id, A.owner.userId);

      // Materialised Assessment rows: arm1×Maths s1 signed off, s2 not; arm1×English s1 not.
      const assess = (studentId: string, subjectId: string, signed: boolean) =>
        db.assessment.create({
          data: {
            schoolId: A.schoolId, studentId, subjectId, termId: term.id, academicYearId: year.id, classArmId: A.arm1.id,
            totalScore: 10, computedAt: new Date(), subjectSignedOffAt: signed ? new Date() : null, subjectSignedOffBy: signed ? A.t1.userId : null,
          },
        });
      await assess(s1, A.maths, true);
      await assess(s2, A.maths, false);
      await assess(s1, A.english, false);

      // Report cards: arm1 s1 RELEASED, s2 DRAFT; arm2 s3 none.
      await db.reportCard.create({ data: { schoolId: A.schoolId, studentId: s1, termId: term.id, academicYearId: year.id, classArmId: A.arm1.id, status: "RELEASED" } });
      await db.reportCard.create({ data: { schoolId: A.schoolId, studentId: s2, termId: term.id, academicYearId: year.id, classArmId: A.arm1.id, status: "DRAFT" } });

      // School calendar events.
      await db.schoolEvent.createMany({
        data: [
          { schoolId: A.schoolId, title: "Founders' Day", category: "HOLIDAY", startDate: d("2026-03-10"), endDate: d("2026-03-10"), createdBy: A.owner.userId, updatedBy: A.owner.userId },
          { schoolId: A.schoolId, title: "Mid-term break", category: "BREAK", startDate: d("2026-03-12"), endDate: d("2026-03-13"), createdBy: A.owner.userId, updatedBy: A.owner.userId },
          { schoolId: A.schoolId, title: "PTA meeting", category: "MEETING", startDate: d("2026-03-05"), endDate: d("2026-03-05"), createdBy: A.owner.userId, updatedBy: A.owner.userId },
        ],
      });
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.schoolHiddenNationalEvent.deleteMany({});
        await db.schoolEvent.deleteMany({});
        await db.reportCard.deleteMany({});
        await db.assessment.deleteMany({});
        await db.assessmentScore.deleteMany({});
        await db.attendanceRecord.deleteMany({});
        await db.teacherAssignment.deleteMany({});
        await db.enrollment.deleteMany({});
      }).catch(() => undefined);
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  // ===========================================================================
  // School days + attendance (D33–D34)
  // ===========================================================================

  describe("expected registers", () => {
    it("counts 15 school days for the term, listing exactly the five excluded weekdays and why", async () => {
      const r = await service().getCompleteness(A.owner, A.termId);
      expect(r.schoolDays).toEqual({
        asOf: "2026-03-31",
        countedFrom: "2026-03-02",
        countedTo: "2026-03-27",
        schoolDayCount: 15,
        excludedDays: [
          { date: "2026-03-10", reason: "Founders' Day (school holiday)" },
          { date: "2026-03-12", reason: "Mid-term break (school break)" },
          { date: "2026-03-13", reason: "Mid-term break (school break)" },
          { date: "2026-03-19", reason: "Eid-el-Fitr (public holiday)" },
          { date: "2026-03-20", reason: "Eid-el-Fitr (public holiday)" },
        ],
      });
    });

    it("per arm: expected 15; arm 1 took 4 on school days (a day with two students counts once) and 3 on non-school days; arm 3 with no enrollment is absent", async () => {
      const r = await service().getCompleteness(A.owner, A.termId);
      expect(r.attendance!.rows).toEqual([
        {
          groupId: A.arm1.id, label: "Arm-One", classLevelName: expect.any(String), enrolledCount: 2,
          registersExpected: 15, registersTaken: 4, registersOnNonSchoolDays: 3, lastRegisterDate: "2026-03-23",
        },
        {
          groupId: A.arm2.id, label: "Arm-Two", classLevelName: expect.any(String), enrolledCount: 1, // WITHDRAWN s4 not counted
          registersExpected: 15, registersTaken: 0, registersOnNonSchoolDays: 0, lastRegisterDate: null,
        },
      ]);
      expect(r.attendance!.totals).toEqual({ registersExpected: 30, registersTaken: 4, registersOnNonSchoolDays: 3 });
    });

    it("mid-term: counts only up to today — on Wed 11 Mar, 7 school days (2,3,4,5,6,9,11; 10 is the holiday) and 3 registers taken", async () => {
      const s = service();
      s.todayFn = () => "2026-03-11";
      const r = await s.getCompleteness(A.owner, A.termId);
      expect(r.schoolDays).toMatchObject({ countedTo: "2026-03-11", schoolDayCount: 7 });
      expect(r.attendance!.rows[0]).toMatchObject({ registersExpected: 7, registersTaken: 3, registersOnNonSchoolDays: 2 });
    });

    it("before the term starts: nothing is expected and nothing is counted", async () => {
      const s = service();
      s.todayFn = () => "2026-02-20";
      const r = await s.getCompleteness(A.owner, A.termId);
      expect(r.schoolDays).toEqual({ asOf: "2026-02-20", countedFrom: null, countedTo: null, schoolDayCount: 0, excludedDays: [] });
      expect(r.attendance!.totals).toEqual({ registersExpected: 0, registersTaken: 0, registersOnNonSchoolDays: 0 });
    });

    it("a national holiday HIDDEN by this school is no longer excluded: 17 school days, and Eid registers would count", async () => {
      const eid = await basePrisma.nationalEvent.findUnique({ where: { key: "eid-el-fitr-2026" }, select: { id: true } });
      await withTenant(A.schoolId, (db) =>
        db.schoolHiddenNationalEvent.create({ data: { schoolId: A.schoolId, nationalEventId: eid!.id, hiddenBy: A.owner.userId } }),
      );
      try {
        const r = await service().getCompleteness(A.owner, A.termId);
        expect(r.schoolDays!.schoolDayCount).toBe(17);
        expect(r.schoolDays!.excludedDays.map((x) => x.date)).toEqual(["2026-03-10", "2026-03-12", "2026-03-13"]);
        // Thu 19 is now a school day, so its register moves from "non-school" to "taken".
        expect(r.attendance!.rows[0]).toMatchObject({ registersExpected: 17, registersTaken: 5, registersOnNonSchoolDays: 2 });
      } finally {
        await withTenant(A.schoolId, (db) => db.schoolHiddenNationalEvent.deleteMany({ where: { schoolId: A.schoolId } }));
      }
    });
  });

  // ===========================================================================
  // Score slots (D35)
  // ===========================================================================

  describe("expected score slots", () => {
    it("counts only effective assignments: arm1×English 2 of 6, arm1×Maths 4 of 6 (whole-year assignment); later-term and inactive assignments owe nothing", async () => {
      const r = await service().getCompleteness(A.owner, A.termId);
      expect(r.scores!.rows.map((x) => ({ arm: x.label, subjectId: x.subjectId, exp: x.slotsExpected, ent: x.slotsEntered, comps: x.componentCount, enr: x.enrolledCount, withScores: x.studentsWithScores, signed: x.studentsSignedOff })))
        .toEqual([
          { arm: "Arm-One", subjectId: A.english, exp: 6, ent: 2, comps: 3, enr: 2, withScores: 1, signed: 0 },
          { arm: "Arm-One", subjectId: A.maths, exp: 6, ent: 4, comps: 3, enr: 2, withScores: 2, signed: 1 },
        ]);
      expect(r.scores!.totals).toEqual({ slotsExpected: 12, slotsEntered: 6 });
    });

    it("reports scores with no effective assignment separately, and never counts a WITHDRAWN student's score", async () => {
      const r = await service().getCompleteness(A.owner, A.termId);
      expect(r.scores!.unassigned).toEqual([
        { groupId: A.arm2.id, label: "Arm-Two", subjectId: A.science, subjectName: `Science ${runId}`, slotsEntered: 1 },
      ]);
    });
  });

  // ===========================================================================
  // Report-card pipeline (D36)
  // ===========================================================================

  it("report cards: arm1 1 RELEASED + 1 DRAFT; arm2's only student has no card", async () => {
    const r = await service().getCompleteness(A.owner, A.termId);
    const zero = { DRAFT: 0, SUBJECT_REVIEWED: 0, FORM_REVIEWED: 0, PRINCIPAL_APPROVED: 0, RELEASED: 0 };
    expect(r.reportCards!.rows.map((x) => ({ arm: x.label, byStatus: x.byStatus, none: x.studentsWithoutCard }))).toEqual([
      { arm: "Arm-One", byStatus: { ...zero, DRAFT: 1, RELEASED: 1 }, none: 0 },
      { arm: "Arm-Two", byStatus: zero, none: 1 },
    ]);
    expect(r.reportCards!.totals).toEqual({ byStatus: { ...zero, DRAFT: 1, RELEASED: 1 }, studentsWithoutCard: 1 });
  });

  // ===========================================================================
  // Term health (D32)
  // ===========================================================================

  describe("term health", () => {
    it("school A: current term ended, a later term not made current, arm 2 has no form teacher and no effective subject teacher", async () => {
      const r = await service().getCompleteness(A.owner, A.termId);
      expect(r.health.map((h) => [h.code, h.arms, h.href])).toEqual([
        ["CURRENT_TERM_ENDED", [], "/settings/academic"],
        ["NEXT_TERM_NOT_CURRENT", [], "/settings/academic"],
        ["ARMS_WITHOUT_FORM_TEACHER", ["Arm-Two"], "/settings/academic"],
        ["ARMS_WITHOUT_SUBJECT_TEACHERS", ["Arm-Two"], "/staff"],
      ]);
      expect(r.health[0].message).toContain("Fri 27 Mar 2026");
    });

    it("the same term viewed while it is still running raises no term-ended signals", async () => {
      const s = service();
      s.todayFn = () => "2026-03-20";
      const r = await s.getCompleteness(A.owner, A.termId);
      expect(r.health.map((h) => h.code)).toEqual(["ARMS_WITHOUT_FORM_TEACHER", "ARMS_WITHOUT_SUBJECT_TEACHERS"]);
    });

    it("a school with no terms at all: NO_CURRENT_TERM, every section null — never an error", async () => {
      const z = await createSchool("zero");
      const r = await service().getCompleteness(z.owner, undefined);
      expect(r).toEqual({ term: null, health: [expect.objectContaining({ code: "NO_CURRENT_TERM" })], schoolDays: null, attendance: null, scores: null, reportCards: null });
    });

    it("students enrolled last term but not this one: ENROLLMENT_NOT_ROLLED_OVER (not the generic no-enrollment signal)", async () => {
      const c = await createSchool("roll");
      await withTenant(c.schoolId, async (db) => {
        const y = await db.academicYear.create({ data: { schoolId: c.schoolId, label: `R-${runId}`, startDate: d("2026-01-05"), endDate: d("2026-07-24") }, select: { id: true } });
        const prev = await db.term.create({ data: { schoolId: c.schoolId, academicYearId: y.id, sequence: 1, name: "T1", startDate: d("2026-01-05"), endDate: d("2026-02-27") }, select: { id: true } });
        await db.term.create({ data: { schoolId: c.schoolId, academicYearId: y.id, sequence: 2, name: "T2", startDate: d("2026-03-02"), endDate: d("2026-04-30"), isCurrent: true } });
        const level = await db.classLevel.findFirst({ where: { schoolId: c.schoolId }, select: { id: true } });
        const arm = await db.classArm.create({ data: { schoolId: c.schoolId, classLevelId: level!.id, name: "R-Arm", code: `r-${runId}` }, select: { id: true } });
        const st = await db.student.create({ data: { schoolId: c.schoolId, admissionNumber: `R-${runId}`, firstName: "R", lastName: "S", dateOfBirth: d("2014-01-01"), gender: "MALE" }, select: { id: true } });
        await db.enrollment.create({ data: { schoolId: c.schoolId, studentId: st.id, termId: prev.id, academicYearId: y.id, classArmId: arm.id } });
      });
      const r = await service().getCompleteness(c.owner, undefined);
      expect(r.health.map((h) => h.code)).toEqual(["ENROLLMENT_NOT_ROLLED_OVER"]);
      expect(r.attendance).toEqual({ rows: [], totals: { registersExpected: 0, registersTaken: 0, registersOnNonSchoolDays: 0 } });
    });
  });

  // ===========================================================================
  // Tenant isolation
  // ===========================================================================

  it("another school's term id is a 404, and school A's figures are unchanged by another school's data", async () => {
    const b = await createSchool("b");
    await expect(service().getCompleteness(b.owner, A.termId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service().getTeacherActivity(b.owner, A.termId, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    const r = await service().getCompleteness(A.owner, A.termId);
    expect(r.attendance!.totals.registersTaken).toBe(4);
    expect(r.scores!.totals).toEqual({ slotsExpected: 12, slotsEntered: 6 });
  });

  // ===========================================================================
  // Teacher recording activity (D37) + audit (D23)
  // ===========================================================================

  describe("teacher recording activity", () => {
    it("attributes registers to the form arm, separates what the person keyed themselves, and has no outcome fields", async () => {
      const r = await service().getTeacherActivity(A.owner, A.termId, reqCtx);
      const t1 = r.rows.find((x) => x.userId === A.t1.userId)!;
      const t2 = r.rows.find((x) => x.userId === A.t2.userId)!;
      expect(t1).toEqual({
        userId: A.t1.userId,
        name: "Tolu Adeyemi",
        formArms: ["Arm-One"],
        formArmRegistersExpected: 15,
        formArmRegistersTaken: 4, // taken on arm 1, whoever marked them
        registersMarkedByThisPerson: 2, // Mon 2 and Tue 3
        assignmentCount: 2, // Maths (whole year) + English (this term)
        assignedSlotsExpected: 12,
        assignedSlotsEntered: 6,
        assignedSlotsEnteredByThisPerson: 5, // 3 Maths + 2 English; the owner keyed 1
        lastRegisterMarkedAt: expect.any(String),
        lastScoreEnteredAt: expect.any(String),
      });
      expect(t2).toMatchObject({ formArms: [], formArmRegistersExpected: 0, registersMarkedByThisPerson: 0, assignmentCount: 0, assignedSlotsExpected: 0, lastRegisterMarkedAt: null });
      // Bursar and owner are not "teachers" and get no row.
      expect(r.rows.map((x) => x.userId).sort()).toEqual([A.t1.userId, A.t2.userId].sort());
      const keys = Object.keys(t1).join(",");
      expect(keys).not.toMatch(/score\b|average|grade|position|rank|pass/i);
    });

    it("writes exactly one tenant-scoped audit row per read", async () => {
      const count = () =>
        withTenant(A.schoolId, (db) => db.auditLog.count({ where: { action: "reports.teacher-activity.view", userId: A.owner.userId } }));
      const before = await count();
      await service().getTeacherActivity(A.owner, A.termId, reqCtx);
      await service().getTeacherActivity(A.owner, A.termId, reqCtx);
      expect(await count()).toBe(before + 2);
      const row = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "reports.teacher-activity.view" }, orderBy: { createdAt: "desc" }, select: { schoolId: true, entityId: true } }),
      );
      expect(row).toEqual({ schoolId: A.schoolId, entityId: A.termId });
    });

    it("the completeness report itself writes no audit row (only the teacher view is audited)", async () => {
      const count = () => withTenant(A.schoolId, (db) => db.auditLog.count({ where: { action: { startsWith: "reports." } } }));
      const before = await count();
      await service().getCompleteness(A.owner, A.termId);
      expect(await count()).toBe(before);
    });
  });

  // ===========================================================================
  // Both authorization gates (D39)
  // ===========================================================================

  describe("authorization", () => {
    it("the guard refuses teacher and bursar on both endpoints, and admits the owner", async () => {
      for (const who of [A.t1, A.bursar]) {
        for (const h of [ReportsController.prototype.completeness, ReportsController.prototype.teacherActivity]) {
          await expect(guard.canActivate(guardCtx(h, who)), h.name).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
      await expect(guard.canActivate(guardCtx(ReportsController.prototype.completeness, A.owner))).resolves.toBe(true);
      await expect(guard.canActivate(guardCtx(ReportsController.prototype.teacherActivity, A.owner))).resolves.toBe(true);
    });

    it("the service's own gate refuses teacher and bursar too (independent second gate), and writes no audit row for them", async () => {
      for (const who of [A.t1, A.bursar]) {
        await expect(service().getCompleteness(who, A.termId)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(service().getTeacherActivity(who, A.termId, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      }
      const leaked = await withTenant(A.schoolId, (db) =>
        db.auditLog.count({ where: { action: "reports.teacher-activity.view", userId: { in: [A.t1.userId, A.bursar.userId] } } }),
      );
      expect(leaked).toBe(0);
    });

    it("a deactivated owner is refused", async () => {
      const x = await createSchool("inactive");
      await withTenant(x.schoolId, (db) => db.user.update({ where: { id: x.owner.userId }, data: { isActive: false } }));
      await expect(service().getCompleteness(x.owner, undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
