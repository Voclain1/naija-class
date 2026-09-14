import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, type TeacherTimetableDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { TeacherTimetableController } from "./timetable-read.controllers";
import { TimetableTeacherReader } from "./timetable-teacher-reader";
import { createTimetableFixture, MON, TUE, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP4 — a teacher's own timetable (docs/modules/phase-8.md §18 D37, Q38),
// against a REAL Postgres.
//
// THE WEEK (year Y):
//   JSS 1A whole-year: Tunde Mon P1; Uche Fri P1          (Tunde is FORM TEACHER of 1A)
//   JSS 1A Second Term override: Tunde Thu P1 only
//   JSS 1B whole-year: Tunde Tue P2; Uche Fri P4
//   JSS 1C whole-year: Tunde + Uche Wed P3 (co-taught)
//
// Tunde's First Term:  Mon P1 1A, Tue P2 1B, Wed P3 1C (with Uche) — plus 1A's grid.
// Tunde's Second Term: Tue P2 1B, Wed P3 1C, Thu P1 1A (the override replaces Mon P1).

const WED = 3;
const THU = 4;
const FRI = 5;

describe("teacher 'my timetable' (Phase 8 CP4) — real database", () => {
  let fx: TimetableFixture;
  const reader = new TimetableTeacherReader();
  let tunde: AuthContext;
  let uche: AuthContext;

  beforeAll(async () => {
    fx = await createTimetableFixture("teach");
    tunde = { sessionId: "s", userId: fx.teachers.tunde, schoolId: fx.schoolId } as AuthContext;
    uche = { sessionId: "s", userId: fx.teachers.uche, schoolId: fx.schoolId } as AuthContext;
    await withTenant(fx.schoolId, async (db) => {
      await db.term.update({ where: { id: fx.terms.first }, data: { isCurrent: true } });
      await db.classArm.update({ where: { id: fx.arms.a }, data: { classTeacherId: fx.teachers.tunde } });
      // Uche co-teaches 1C Maths here (the shared fixture does not assign it).
      await db.teacherAssignment.create({
        data: { schoolId: fx.schoolId, teacherId: fx.teachers.uche, classArmId: fx.arms.c, subjectId: fx.subjects.maths, academicYearId: fx.year },
      });
    });
    const a = await fx.timetable("a", null);
    await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
    await fx.lesson(a.id, FRI, "p1", [fx.teachers.uche]);
    const a2 = await fx.timetable("a", fx.terms.second);
    await fx.lesson(a2.id, THU, "p1", [fx.teachers.tunde]);
    const b = await fx.timetable("b", null);
    await fx.lesson(b.id, TUE, "p2", [fx.teachers.tunde]);
    await fx.lesson(b.id, FRI, "p4", [fx.teachers.uche]);
    const c = await fx.timetable("c", null);
    await fx.lesson(c.id, WED, "p3", [fx.teachers.tunde, fx.teachers.uche]);
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  const own = (r: TeacherTimetableDto) =>
    r.ownLessons.map((l) => `${l.dayOfWeek}/${l.slot.label}/${l.className}/${l.subjectName}${l.coTeacherNames.length ? `/with ${l.coTeacherNames.join("+")}` : ""}`);

  it("current term by default: own lessons across classes, in day and period order, with co-teachers named", async () => {
    const r = await reader.getMyTimetable(tunde, undefined);
    expect(r.term).toEqual({ id: fx.terms.first, name: "First Term" });
    expect(own(r)).toEqual(["1/P1/JSS 1A/Mathematics", "2/P2/JSS 1B/Mathematics", "3/P3/JSS 1C/Mathematics/with Uche Eze"]);
    expect(r.terms.map((t) => t.name)).toEqual(["First Term", "Second Term", "Third Term"]);
  });

  it("resolves what is IN FORCE for the chosen term: the override replaces 1A's whole-year lessons in Second Term", async () => {
    const r = await reader.getMyTimetable(tunde, fx.terms.second);
    expect(own(r)).toEqual(["2/P2/JSS 1B/Mathematics", "3/P3/JSS 1C/Mathematics/with Uche Eze", "4/P1/JSS 1A/Mathematics"]);
  });

  it("another teacher's lessons never appear in the own-lessons list", async () => {
    const r = await reader.getMyTimetable(tunde, undefined);
    expect(r.ownLessons.some((l) => l.dayOfWeek === FRI)).toBe(false);
    expect(own(await reader.getMyTimetable(uche, undefined))).toEqual([
      "3/P3/JSS 1C/Mathematics/with Tunde Bello",
      "5/P1/JSS 1A/Mathematics",
      "5/P4/JSS 1B/Mathematics",
    ]);
  });

  it("Q38: the FORM class's full grid is included (other teachers' lessons in it too); a class he only teaches in is NOT", async () => {
    const r = await reader.getMyTimetable(tunde, undefined);
    expect(r.formClasses.map((f) => f.className)).toEqual(["JSS 1A"]);
    expect(r.formClasses[0]!.lessons.map((l) => `${l.dayOfWeek}/${l.teachers.map((t) => t.name).join("+")}`)).toEqual([
      "1/Tunde Bello",
      "5/Uche Eze",
    ]);
    expect((await reader.getMyTimetable(uche, undefined)).formClasses).toEqual([]); // form teacher of nothing
  });

  it("D44: a deactivated class disappears from own lessons and form classes", async () => {
    await withTenant(fx.schoolId, (db) => db.classArm.updateMany({ where: { id: { in: [fx.arms.a, fx.arms.c] } }, data: { isActive: false } }));
    try {
      const r = await reader.getMyTimetable(tunde, undefined);
      expect(own(r)).toEqual(["2/P2/JSS 1B/Mathematics"]);
      expect(r.formClasses).toEqual([]);
    } finally {
      await withTenant(fx.schoolId, (db) => db.classArm.updateMany({ where: { id: { in: [fx.arms.a, fx.arms.c] } }, data: { isActive: true } }));
    }
  });

  it("a term of another school → 404; no current term → an empty result, not an error", async () => {
    await expect(reader.getMyTimetable(tunde, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await withTenant(fx.schoolId, (db) => db.term.update({ where: { id: fx.terms.first }, data: { isCurrent: false } }));
    try {
      expect(await reader.getMyTimetable(tunde, undefined)).toMatchObject({ term: null, ownLessons: [], formClasses: [] });
    } finally {
      await withTenant(fx.schoolId, (db) => db.term.update({ where: { id: fx.terms.first }, data: { isCurrent: true } }));
    }
  });

  it("two gates: the service refuses the owner (builder users) and the guard refuses a role without timetable.own.read", async () => {
    await expect(reader.getMyTimetable(fx.owner, undefined)).rejects.toBeInstanceOf(ForbiddenError);

    const bursar = await withTenant(fx.schoolId, async (db) => {
      const u = await db.user.create({
        data: { schoolId: fx.schoolId, firstName: "Ben", lastName: "Bursar", email: `tt-bursar-${fx.runId}@example.test`, passwordHash: "argon2id$placeholder" },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { schoolId: null, key: "bursar", isSystem: true }, select: { id: true } });
      await db.userRole.create({ data: { userId: u.id, roleId: role!.id } });
      return { sessionId: "s", userId: u.id, schoolId: fx.schoolId } as AuthContext;
    });
    const guard = new PermissionsGuard(new Reflector());
    const ctx = (user: AuthContext) =>
      ({
        getHandler: () => TeacherTimetableController.prototype.myTimetable,
        getClass: () => TeacherTimetableController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx(bursar))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(guard.canActivate(ctx(tunde))).resolves.toBe(true);
  });
});
