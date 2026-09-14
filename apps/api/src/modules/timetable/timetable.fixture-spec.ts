import { basePrisma, withTenant } from "@school-kit/db";
import type { SaveLessonResultDto, TimetableHeaderDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthService } from "../auth/auth.service";
import { TimetableService } from "./timetable.service";

// Shared REAL-database fixture for the CP3 timetable specs (docs/modules/phase-8.md
// §17.6). Named *.fixture-spec.ts so the build excludes it and Vitest does not
// collect it as a spec.
//
// One school per fixture. Everything below is hand-stated so each spec can
// reason about exactly which lessons are in force where:
//
//   Year Y  (2026/2027)  terms: First Term (1), Second Term (2), Third Term (3)
//   Year Y2 (2027/2028)  terms: First Term (1)
//   Year Y0 (no terms)
//
//   Classes: JSS 1A, JSS 1B, JSS 1C
//   Subjects: Mathematics, English
//
//   Bell schedule (one per school, D26):
//     P1 08:00–08:40 LESSON | P2 08:40–09:20 LESSON | Break 09:20–09:40 BREAK
//     P3 09:40–10:20 LESSON | P4 10:20–11:00 LESSON
//   School week: Monday–Friday (default)
//
//   Teachers and their ACTIVE assignments:
//     Tunde Bello   Y:  Maths × 1A, 1B, 1C (whole year)       Y2: Maths × 1A, 1B (whole year)
//                        English × 1A — INACTIVE assignment
//     Uche Eze      Y:  Maths × 1A, 1B (whole year); English × 1A (First Term only)
//     Nkechi Obi    no assignments at all
//     Ifeoma Nwosu  Y:  Maths × 1A (whole year) — but her USER is inactive

let phone = 0;
const randomPhone = () =>
  `+23486${String(++phone % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

export const MON = 1;
export const TUE = 2;

export interface TimetableFixture {
  runId: string;
  schoolId: string;
  owner: AuthContext;
  service: TimetableService;
  year: string;
  terms: { first: string; second: string; third: string };
  year2: string;
  year2Term: string;
  yearNoTerms: string;
  arms: { a: string; b: string; c: string };
  subjects: { maths: string; english: string };
  teachers: { tunde: string; uche: string; nkechi: string; ifeoma: string };
  slots: { p1: string; p2: string; brk: string; p3: string; p4: string };
  /** Create a timetable through the service (so it is checked + audited). */
  timetable(arm: keyof TimetableFixture["arms"], termId: string | null, yearId?: string): Promise<TimetableHeaderDto>;
  /** Save a lesson through the service. */
  lesson(
    timetableId: string,
    day: number,
    slot: keyof TimetableFixture["slots"],
    teacherIds: string[],
    opts?: { subject?: keyof TimetableFixture["subjects"]; span?: number },
  ): Promise<SaveLessonResultDto>;
  /** Remove every timetable (entries cascade), keeping the school, slots and assignments. */
  reset(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createTimetableFixture(tag: string): Promise<TimetableFixture> {
  const runId = Math.random().toString(36).slice(2, 8);
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Timetable ${tag} ${runId}`,
      schoolSlug: `tt-${tag}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `tt-${tag}-${runId}@example.test`,
      ownerPhone: randomPhone(),
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  const schoolId = signed.school.id;
  const owner = { sessionId: "s", userId: signed.user.id, schoolId } as AuthContext;
  const service = new TimetableService();
  const reqCtx = { ipAddress: "127.0.0.1" };

  const built = await withTenant(schoolId, async (db) => {
    const teacherRole = await db.role.findFirst({ where: { schoolId: null, key: "teacher", isSystem: true }, select: { id: true } });
    const mkTeacher = async (first: string, last: string, isActive = true) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: first,
          lastName: last,
          email: `tt-${first.toLowerCase()}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
          isActive,
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: u.id, roleId: teacherRole!.id } });
      return u.id;
    };
    const teachers = {
      tunde: await mkTeacher("Tunde", "Bello"),
      uche: await mkTeacher("Uche", "Eze"),
      nkechi: await mkTeacher("Nkechi", "Obi"),
      ifeoma: await mkTeacher("Ifeoma", "Nwosu", false),
    };

    const mkYear = (label: string, start: string, end: string) =>
      db.academicYear.create({ data: { schoolId, label: `${label}-${runId}`, startDate: d(start), endDate: d(end) }, select: { id: true } });
    const mkTerm = (academicYearId: string, sequence: number, name: string, start: string, end: string) =>
      db.term.create({ data: { schoolId, academicYearId, sequence, name, startDate: d(start), endDate: d(end) }, select: { id: true } });

    const year = (await mkYear("Y", "2026-09-07", "2027-07-23")).id;
    const terms = {
      first: (await mkTerm(year, 1, "First Term", "2026-09-07", "2026-12-11")).id,
      second: (await mkTerm(year, 2, "Second Term", "2027-01-11", "2027-04-02")).id,
      third: (await mkTerm(year, 3, "Third Term", "2027-04-26", "2027-07-23")).id,
    };
    const year2 = (await mkYear("Y2", "2027-09-06", "2028-07-21")).id;
    const year2Term = (await mkTerm(year2, 1, "First Term", "2027-09-06", "2027-12-10")).id;
    const yearNoTerms = (await mkYear("Y0", "2028-09-04", "2029-07-20")).id;

    const level = await db.classLevel.findFirst({ where: { schoolId }, orderBy: { orderIndex: "asc" }, select: { id: true } });
    const mkArm = async (name: string) =>
      (await db.classArm.create({ data: { schoolId, classLevelId: level!.id, name, code: `${name.replace(/\s/g, "").toLowerCase()}-${runId}` }, select: { id: true } })).id;
    const arms = { a: await mkArm("JSS 1A"), b: await mkArm("JSS 1B"), c: await mkArm("JSS 1C") };

    const mkSubject = async (name: string) =>
      (await db.subject.create({ data: { schoolId, name, code: `${name.toLowerCase()}-${runId}` }, select: { id: true } })).id;
    const subjects = { maths: await mkSubject("Mathematics"), english: await mkSubject("English") };

    const a = (teacherId: string, classArmId: string, subjectId: string, academicYearId: string, termId: string | null = null, isActive = true) => ({
      schoolId, teacherId, classArmId, subjectId, academicYearId, termId, isActive,
    });
    await db.teacherAssignment.createMany({
      data: [
        a(teachers.tunde, arms.a, subjects.maths, year),
        a(teachers.tunde, arms.b, subjects.maths, year),
        a(teachers.tunde, arms.c, subjects.maths, year),
        a(teachers.tunde, arms.a, subjects.english, year, null, false),
        a(teachers.tunde, arms.a, subjects.maths, year2),
        a(teachers.tunde, arms.b, subjects.maths, year2),
        a(teachers.uche, arms.a, subjects.maths, year),
        a(teachers.uche, arms.b, subjects.maths, year),
        a(teachers.uche, arms.a, subjects.english, year, terms.first),
        a(teachers.ifeoma, arms.a, subjects.maths, year),
      ],
    });
    return { teachers, year, terms, year2, year2Term, yearNoTerms, arms, subjects };
  });

  const schedule = await service.saveBellSchedule(
    owner,
    {
      slots: [
        { label: "P1", kind: "LESSON", startMinute: 480, endMinute: 520 },
        { label: "P2", kind: "LESSON", startMinute: 520, endMinute: 560 },
        { label: "Break", kind: "BREAK", startMinute: 560, endMinute: 580 },
        { label: "P3", kind: "LESSON", startMinute: 580, endMinute: 620 },
        { label: "P4", kind: "LESSON", startMinute: 620, endMinute: 660 },
      ],
      schoolWeekDays: [1, 2, 3, 4, 5],
    },
    reqCtx,
  );
  const [p1, p2, brk, p3, p4] = schedule.slots.map((s) => s.id) as [string, string, string, string, string];
  const slots = { p1, p2, brk, p3, p4 };

  const fx: TimetableFixture = {
    runId,
    schoolId,
    owner,
    service,
    ...built,
    slots,
    timetable: (arm, termId, yearId) =>
      service.createTimetable(owner, { classArmId: built.arms[arm], academicYearId: yearId ?? built.year, termId }, reqCtx),
    lesson: (timetableId, day, slot, teacherIds, opts) =>
      service.saveLesson(
        owner,
        {
          timetableId,
          dayOfWeek: day,
          bellSlotId: slots[slot],
          subjectId: built.subjects[opts?.subject ?? "maths"],
          teacherIds,
          span: opts?.span ?? 1,
        },
        reqCtx,
      ),
    reset: () => withTenant(schoolId, async (db) => void (await db.timetable.deleteMany({ where: { schoolId } }))),
    cleanup: async () => {
      await withTenant(schoolId, async (db) => {
        await db.timetable.deleteMany({ where: { schoolId } });
        await db.bellSlot.deleteMany({ where: { schoolId } });
      });
      await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
    },
  };
  return fx;
}
