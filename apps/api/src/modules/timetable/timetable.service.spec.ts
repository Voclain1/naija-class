import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { withTenant } from "@school-kit/db";
import { ForbiddenError, UnauthorizedError, type TimetableClashDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { TimetableController } from "./timetable.controller";

import { findTimetableClashes } from "./timetable-clash";
import { createTimetableFixture, MON, TUE, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP3 — timetable clash rules, assignment validity (D33) and the bell
// schedule, against a REAL Postgres. docs/modules/phase-8.md §17.6 items 2, 5, 6.
//
// Every case is hand-constructed on the fixture described in
// timetable.fixture-spec.ts; `fx.reset()` removes all timetables between cases,
// so each case states the whole timetable it needs.
//
// Where a case asserts a clash SET (which terms clash), the data is inserted
// directly — bypassing the service, which would refuse to save it — and the
// real clash query is run over it. Where a case asserts the service's
// behaviour, it goes through the service and checks both the error AND that the
// transaction rolled back.

const reqCtx = { ipAddress: "127.0.0.1" };

describe("TimetableService (Phase 8 CP3) — real database", () => {
  let fx: TimetableFixture;

  beforeAll(async () => {
    fx = await createTimetableFixture("svc");
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(async () => {
    await fx.reset();
    fx.service.clashFn = findTimetableClashes;
  });

  async function lessonCount(timetableId: string): Promise<number> {
    return withTenant(fx.schoolId, (db) => db.timetableEntry.count({ where: { timetableId } }));
  }

  /** Insert a lesson directly — no lock, no clash check — to build states the service refuses. */
  async function rawLesson(timetableId: string, day: number, slotId: string, teacherIds: string[]): Promise<void> {
    await withTenant(fx.schoolId, async (db) => {
      const e = await db.timetableEntry.create({
        data: { schoolId: fx.schoolId, timetableId, dayOfWeek: day, bellSlotId: slotId, subjectId: fx.subjects.maths, updatedBy: fx.owner.userId },
        select: { id: true },
      });
      await db.timetableEntryTeacher.createMany({ data: teacherIds.map((teacherId) => ({ schoolId: fx.schoolId, entryId: e.id, teacherId })) });
    });
  }

  async function rawTimetable(arm: "a" | "b" | "c", termId: string | null, yearId = fx.year): Promise<string> {
    return withTenant(fx.schoolId, async (db) =>
      (await db.timetable.create({
        data: { schoolId: fx.schoolId, classArmId: fx.arms[arm], academicYearId: yearId, termId, createdBy: fx.owner.userId },
        select: { id: true },
      })).id,
    );
  }

  const clashesIn = (yearId: string): Promise<TimetableClashDto[]> =>
    withTenant(fx.schoolId, (db) => findTimetableClashes(db, fx.schoolId, yearId));

  // ===========================================================================
  // §17.6 item 2 — the clash cases
  // ===========================================================================

  describe("clash detection (D30/D31)", () => {
    it("same teacher, same day and slot, two classes, both year-wide → refused, and rolled back", async () => {
      const a = await fx.timetable("a", null);
      const b = await fx.timetable("b", null);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);

      const err = await fx.lesson(b.id, MON, "p1", [fx.teachers.tunde]).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "TIMETABLE_CLASH", httpStatus: 409 });
      const clashes = (err as { details: { clashes: TimetableClashDto[] } }).details.clashes;
      // Year-wide in all three terms → one clash per term, first named = First Term.
      expect(clashes.map((c) => c.termName)).toEqual(["First Term", "Second Term", "Third Term"]);
      expect(clashes[0]).toMatchObject({
        teacherId: fx.teachers.tunde,
        teacherName: "Tunde Bello",
        dayOfWeek: MON,
        bellSlotId: fx.slots.p1,
        slotLabel: "P1",
        classArms: [
          { id: fx.arms.a, name: "JSS 1A" },
          { id: fx.arms.b, name: "JSS 1B" },
        ],
      });
      expect((err as Error).message).toBe(
        "Tunde Bello would be teaching JSS 1A and JSS 1B at the same time — Monday, P1, First Term.",
      );

      // Rolled back: B has no lesson, and exactly ONE lesson-save audit row exists (A's).
      expect(await lessonCount(b.id)).toBe(0);
      const audits = await withTenant(fx.schoolId, (db) =>
        db.auditLog.count({ where: { action: "timetable.lesson.save", entityId: { in: [a.id, b.id] } } }),
      );
      expect(audits).toBe(1);
    });

    it("different day → no clash; different slot → no clash", async () => {
      const a = await fx.timetable("a", null);
      const b = await fx.timetable("b", null);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
      await expect(fx.lesson(b.id, TUE, "p1", [fx.teachers.tunde])).resolves.toMatchObject({ warnings: [] });
      await expect(fx.lesson(b.id, MON, "p2", [fx.teachers.tunde])).resolves.toMatchObject({ warnings: [] });
      expect(await lessonCount(b.id)).toBe(2);
      expect(await clashesIn(fx.year)).toEqual([]);
    });

    it("class A year-wide, class B Second-Term-only → the clash exists ONLY in Second Term, and the error names it", async () => {
      const a = await fx.timetable("a", null);
      const b2 = await fx.timetable("b", fx.terms.second);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);

      const err = await fx.lesson(b2.id, MON, "p1", [fx.teachers.tunde]).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "TIMETABLE_CLASH" });
      const clashes = (err as { details: { clashes: TimetableClashDto[] } }).details.clashes;
      expect(clashes.map((c) => c.termName)).toEqual(["Second Term"]);
      expect((err as Error).message).toContain("Second Term");
      expect(await lessonCount(b2.id)).toBe(0);
    });

    it("class A has a Second-Term timetable WITHOUT the lesson → A's year-wide lesson is not in force in Second Term: clash in First and Third only", async () => {
      // Built directly: the service would refuse B's lesson (it clashes in terms 1 and 3).
      const a = await rawTimetable("a", null);
      await rawTimetable("a", fx.terms.second); // empty — replaces A's year-wide in term 2
      const b = await rawTimetable("b", null);
      await rawLesson(a, MON, fx.slots.p1, [fx.teachers.tunde]);
      await rawLesson(b, MON, fx.slots.p1, [fx.teachers.tunde]);

      const clashes = await clashesIn(fx.year);
      expect(clashes.map((c) => c.termName)).toEqual(["First Term", "Third Term"]);

      // And through the service: re-saving B's lesson is refused, naming First Term.
      await fx.reset();
      const a2 = await fx.timetable("a", null);
      await fx.lesson(a2.id, MON, "p1", [fx.teachers.tunde]);
      await fx.timetable("a", fx.terms.second);
      const bb = await fx.timetable("b", null);
      await expect(fx.lesson(bb.id, MON, "p1", [fx.teachers.tunde])).rejects.toMatchObject({
        code: "TIMETABLE_CLASH",
        message: expect.stringContaining("First Term"),
      });
    });

    it("DELETING A's Second-Term timetable brings A's year-wide lesson back into force → the delete is refused and rolled back", async () => {
      const a = await fx.timetable("a", null);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
      const a2 = await fx.timetable("a", fx.terms.second); // empty: A has nothing on Mon P1 in term 2
      const b2 = await fx.timetable("b", fx.terms.second);
      await fx.lesson(b2.id, MON, "p1", [fx.teachers.tunde]); // fine: A's year-wide is replaced in term 2
      expect(await clashesIn(fx.year)).toEqual([]);

      const err = await fx.service.deleteTimetable(fx.owner, a2.id, reqCtx).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "TIMETABLE_CLASH" });
      expect((err as { details: { clashes: TimetableClashDto[] } }).details.clashes.map((c) => c.termName)).toEqual(["Second Term"]);

      const still = await withTenant(fx.schoolId, (db) => db.timetable.findUnique({ where: { id: a2.id }, select: { id: true } }));
      expect(still).toEqual({ id: a2.id });
    });

    it("deleting a YEAR-WIDE timetable never runs the clash query (removal only removes lessons)", async () => {
      const a = await fx.timetable("a", null);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
      const spy = vi.fn(findTimetableClashes);
      fx.service.clashFn = spy;
      await fx.service.deleteTimetable(fx.owner, a.id, reqCtx);
      expect(spy).not.toHaveBeenCalled();
    });

    it("co-taught lesson where only one teacher clashes → the clash names THAT teacher only", async () => {
      const a = await fx.timetable("a", null);
      const b = await fx.timetable("b", null);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde, fx.teachers.uche]);
      await expect(fx.lesson(b.id, MON, "p2", [fx.teachers.uche])).resolves.toBeDefined(); // Uche elsewhere: fine

      const err = await fx.lesson(b.id, MON, "p1", [fx.teachers.tunde]).catch((e: unknown) => e);
      const clashes = (err as { details: { clashes: TimetableClashDto[] } }).details.clashes;
      expect(new Set(clashes.map((c) => c.teacherName))).toEqual(new Set(["Tunde Bello"]));
    });

    it("two classes in DIFFERENT academic years → never a clash", async () => {
      const a = await fx.timetable("a", null, fx.year);
      const b = await fx.timetable("b", null, fx.year2);
      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
      await expect(fx.lesson(b.id, MON, "p1", [fx.teachers.tunde])).resolves.toBeDefined();
      expect(await clashesIn(fx.year)).toEqual([]);
      expect(await clashesIn(fx.year2)).toEqual([]);
    });

    it("a lesson with NO teacher (Q34) → never a clash", async () => {
      const a = await fx.timetable("a", null);
      const b = await fx.timetable("b", null);
      await fx.lesson(a.id, MON, "p1", []);
      const r = await fx.lesson(b.id, MON, "p1", []);
      expect(r.lessons).toEqual([expect.objectContaining({ dayOfWeek: MON, bellSlotId: fx.slots.p1, teachers: [] })]);
    });

    it("the second half of a double period clashes like any lesson", async () => {
      const a = await fx.timetable("a", null);
      const b = await fx.timetable("b", null);
      const r = await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde], { span: 2 });
      expect(r.lessons.map((l) => l.bellSlotId)).toEqual([fx.slots.p1, fx.slots.p2]);
      await expect(fx.lesson(b.id, MON, "p2", [fx.teachers.tunde])).rejects.toMatchObject({
        code: "TIMETABLE_CLASH",
        message: expect.stringContaining("P2"),
      });
    });
  });

  describe("span (D24)", () => {
    it("spanning into an OCCUPIED cell → refused; into a non-LESSON slot → refused; past the day's end → refused", async () => {
      const a = await fx.timetable("a", null);
      await fx.lesson(a.id, MON, "p2", [fx.teachers.uche]);
      await expect(fx.lesson(a.id, MON, "p1", [fx.teachers.tunde], { span: 2 })).rejects.toMatchObject({ code: "CELL_OCCUPIED" });
      // P2 → Break
      await fx.reset();
      const a2 = await fx.timetable("a", null);
      await expect(fx.lesson(a2.id, MON, "p2", [fx.teachers.tunde], { span: 2 })).rejects.toMatchObject({ code: "NOT_A_LESSON_SLOT" });
      await expect(fx.lesson(a2.id, MON, "brk", [fx.teachers.tunde])).rejects.toMatchObject({ code: "NOT_A_LESSON_SLOT" });
      await expect(fx.lesson(a2.id, MON, "p4", [fx.teachers.tunde], { span: 2 })).rejects.toMatchObject({ code: "SPAN_OUT_OF_RANGE" });
      expect(await lessonCount(a2.id)).toBe(0);
    });

    it("re-saving a double period over its own second half is allowed (editing the block)", async () => {
      const a = await fx.timetable("a", null);
      await fx.lesson(a.id, MON, "p3", [fx.teachers.tunde], { span: 2 });
      const r = await fx.lesson(a.id, MON, "p3", [fx.teachers.tunde, fx.teachers.uche], { span: 2 });
      expect(r.lessons).toHaveLength(2);
      expect(r.lessons.every((l) => l.teachers.length === 2)).toBe(true);
    });

    it("a lesson on a day outside the school week → refused", async () => {
      const a = await fx.timetable("a", null);
      await expect(fx.lesson(a.id, 6, "p1", [fx.teachers.tunde])).rejects.toMatchObject({ code: "NOT_A_SCHOOL_DAY" });
    });
  });

  // ===========================================================================
  // §17.6 item 5 — assignment validity (D33)
  // ===========================================================================

  describe("assignment validity (D33 / Q36)", () => {
    it("no assignment at all → refused", async () => {
      const a = await fx.timetable("a", null);
      await expect(fx.lesson(a.id, MON, "p1", [fx.teachers.nkechi])).rejects.toMatchObject({
        code: "TEACHER_NOT_ASSIGNED",
        message: expect.stringContaining("Nkechi Obi"),
      });
      expect(await lessonCount(a.id)).toBe(0);
    });

    it("assignment effective in SOME terms of a year-wide timetable → saved, with a warning naming the uncovered terms", async () => {
      const a = await fx.timetable("a", null);
      const r = await fx.lesson(a.id, MON, "p1", [fx.teachers.uche], { subject: "english" });
      expect(r.warnings).toEqual([
        { teacherId: fx.teachers.uche, teacherName: "Uche Eze", uncoveredTermNames: ["Second Term", "Third Term"] },
      ]);
      expect(await lessonCount(a.id)).toBe(1);
    });

    it("the same term-only assignment on a First-Term timetable → no warning; on a Second-Term timetable → refused", async () => {
      const t1 = await fx.timetable("a", fx.terms.first);
      await expect(fx.lesson(t1.id, MON, "p1", [fx.teachers.uche], { subject: "english" })).resolves.toMatchObject({ warnings: [] });
      const t2 = await fx.timetable("a", fx.terms.second);
      await expect(fx.lesson(t2.id, MON, "p1", [fx.teachers.uche], { subject: "english" })).rejects.toMatchObject({
        code: "TEACHER_NOT_ASSIGNED",
      });
    });

    it("an INACTIVE assignment counts as none; so does an active assignment held by an INACTIVE teacher", async () => {
      const a = await fx.timetable("a", null);
      await expect(fx.lesson(a.id, MON, "p1", [fx.teachers.tunde], { subject: "english" })).rejects.toMatchObject({
        code: "TEACHER_NOT_ASSIGNED",
      });
      await expect(fx.lesson(a.id, MON, "p1", [fx.teachers.ifeoma])).rejects.toMatchObject({ code: "TEACHER_NOT_ASSIGNED" });
    });
  });

  // ===========================================================================
  // Timetable headers
  // ===========================================================================

  describe("timetable headers (D3)", () => {
    it("one whole-year timetable per class per year, one per class per term", async () => {
      await fx.timetable("a", null);
      await fx.timetable("a", fx.terms.first);
      await expect(fx.timetable("a", null)).rejects.toMatchObject({ code: "TIMETABLE_EXISTS" });
      await expect(fx.timetable("a", fx.terms.first)).rejects.toMatchObject({ code: "TIMETABLE_EXISTS" });
    });

    it("a term from another year → TERM_NOT_IN_YEAR; a year with no terms → YEAR_HAS_NO_TERMS", async () => {
      await expect(fx.timetable("a", fx.year2Term, fx.year)).rejects.toMatchObject({ code: "TERM_NOT_IN_YEAR" });
      await expect(fx.timetable("a", null, fx.yearNoTerms)).rejects.toMatchObject({ code: "YEAR_HAS_NO_TERMS" });
    });

    it("the view resolves the timetable IN FORCE: term timetable if one exists, else the year-wide one", async () => {
      const yw = await fx.timetable("a", null);
      await fx.lesson(yw.id, MON, "p1", [fx.teachers.tunde]);
      const t2 = await fx.timetable("a", fx.terms.second);

      const first = await fx.service.getView(fx.owner, { classArmId: fx.arms.a, termId: fx.terms.first });
      expect(first.inForce?.id).toBe(yw.id);
      expect(first.lessons).toHaveLength(1);

      const second = await fx.service.getView(fx.owner, { classArmId: fx.arms.a, termId: fx.terms.second });
      expect(second.inForce?.id).toBe(t2.id);
      expect(second.yearWide?.id).toBe(yw.id);
      expect(second.lessons).toEqual([]);
      expect(second.assignments.map((x) => `${x.teacherName}/${x.subjectName}`).sort()).toEqual([
        "Tunde Bello/Mathematics",
        "Uche Eze/English",
        "Uche Eze/Mathematics",
      ]); // Tunde's inactive English and inactive Ifeoma excluded
    });
  });

  // ===========================================================================
  // Two gates (D35): the permission guard AND the service's own role assertion
  // ===========================================================================

  describe("authorization — owner/admin only, at both gates", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guardCtx = (handler: (...args: any[]) => unknown, user: AuthContext): ExecutionContext =>
      ({
        getHandler: () => handler,
        getClass: () => TimetableController,
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      }) as unknown as ExecutionContext;
    const teacher = (): AuthContext => ({ sessionId: "s", userId: fx.teachers.tunde, schoolId: fx.schoolId }) as AuthContext;

    it("the guard refuses a teacher on read and manage routes, and admits the owner", async () => {
      const guard = new PermissionsGuard(new Reflector());
      const proto = TimetableController.prototype;
      for (const handler of [proto.view, proto.bellSchedule, proto.saveLesson, proto.saveBellSchedule]) {
        await expect(guard.canActivate(guardCtx(handler, teacher()))).rejects.toBeInstanceOf(ForbiddenError);
        await expect(guard.canActivate(guardCtx(handler, fx.owner))).resolves.toBe(true);
      }
    });

    it("the service's own gate refuses a teacher on every mutation (independent second gate) and writes nothing", async () => {
      const a = await fx.timetable("a", null);
      const t = teacher();
      await expect(fx.service.saveLesson(t, { timetableId: a.id, dayOfWeek: MON, bellSlotId: fx.slots.p1, subjectId: fx.subjects.maths, teacherIds: [], span: 1 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(fx.service.createTimetable(t, { classArmId: fx.arms.c, academicYearId: fx.year, termId: null }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(fx.service.deleteTimetable(t, a.id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(fx.service.clearLesson(t, { timetableId: a.id, dayOfWeek: MON, bellSlotId: fx.slots.p1 }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(fx.service.saveBellSchedule(t, { slots: [], schoolWeekDays: [1] }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      expect(await lessonCount(a.id)).toBe(0);
    });

    it("a deactivated owner is refused", async () => {
      await withTenant(fx.schoolId, (db) => db.user.update({ where: { id: fx.owner.userId }, data: { isActive: false } }));
      try {
        await expect(fx.timetable("c", null)).rejects.toBeInstanceOf(UnauthorizedError);
      } finally {
        await withTenant(fx.schoolId, (db) => db.user.update({ where: { id: fx.owner.userId }, data: { isActive: true } }));
      }
    });
  });

  // ===========================================================================
  // §17.6 item 6 — bell schedule and school week
  // ===========================================================================

  describe("bell schedule and school week (D26/D34)", () => {
    const currentSlots = async () => (await fx.service.getBellSchedule(fx.owner)).slots;
    const asInput = (slots: Awaited<ReturnType<typeof currentSlots>>) =>
      slots.map(({ id, label, kind, startMinute, endMinute }) => ({ id, label, kind, startMinute, endMinute }));

    it("overlapping periods → refused by the service itself (not only the Zod schema)", async () => {
      const slots = asInput(await currentSlots());
      slots[1] = { ...slots[1]!, startMinute: 500 }; // P2 starts before P1 ends
      await expect(
        fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx),
      ).rejects.toMatchObject({ code: "BELL_SLOTS_OVERLAP" });
    });

    it("removing or re-kinding a USED slot → refused with the lesson count; removing a used DAY → refused", async () => {
      const a = await fx.timetable("a", null);
      await fx.lesson(a.id, MON, "p3", [fx.teachers.tunde], { span: 2 });
      await fx.lesson(a.id, TUE, "p3", [fx.teachers.tunde]);
      const slots = asInput(await currentSlots());

      await expect(
        fx.service.saveBellSchedule(fx.owner, { slots: slots.filter((s) => s.label !== "P3"), schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx),
      ).rejects.toMatchObject({ code: "SLOT_IN_USE", message: expect.stringContaining("P3 has 2 lessons"), details: { lessonCount: 2 } });

      await expect(
        fx.service.saveBellSchedule(
          fx.owner,
          { slots: slots.map((s) => (s.label === "P4" ? { ...s, kind: "ASSEMBLY" as const } : s)), schoolWeekDays: [1, 2, 3, 4, 5] },
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "SLOT_IN_USE", details: { lessonCount: 1 } });

      await expect(
        fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [2, 3, 4, 5] }, reqCtx),
      ).rejects.toMatchObject({ code: "DAY_IN_USE", details: { dayOfWeek: 1, lessonCount: 2 } });
    });

    it("editing slot TIMES never runs the clash query; saving a lesson runs it before and after", async () => {
      const a = await fx.timetable("a", null);
      const spy = vi.fn(findTimetableClashes);
      fx.service.clashFn = spy;

      const slots = asInput(await currentSlots()).map((s) => ({ ...s, startMinute: s.startMinute + 5, endMinute: s.endMinute + 5 }));
      const saved = await fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx);
      expect(saved.slots[0]).toMatchObject({ label: "P1", startMinute: 485, endMinute: 525 });
      expect(spy).not.toHaveBeenCalled();

      await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
      // CP4 D43: once BEFORE the write and once AFTER (refuse only an added clash).
      expect(spy).toHaveBeenCalledTimes(2);

      // restore
      await fx.service.saveBellSchedule(
        fx.owner,
        { slots: slots.map((s) => ({ ...s, startMinute: s.startMinute - 5, endMinute: s.endMinute - 5 })), schoolWeekDays: [1, 2, 3, 4, 5] },
        reqCtx,
      );
    });

    it("a Saturday school: adding Saturday lets lessons be timetabled on it", async () => {
      const slots = asInput(await currentSlots());
      await fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [6, 1, 2, 3, 4, 5] }, reqCtx);
      expect((await fx.service.getBellSchedule(fx.owner)).schoolWeekDays).toEqual([1, 2, 3, 4, 5, 6]);
      const a = await fx.timetable("a", null);
      await expect(fx.lesson(a.id, 6, "p1", [fx.teachers.tunde])).resolves.toBeDefined();
      await fx.reset();
      await fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx);
    });

    it("reordering and adding periods keeps ids and positions consistent", async () => {
      const slots = asInput(await currentSlots());
      const next = [...slots, { label: "P5", kind: "LESSON" as const, startMinute: 660, endMinute: 700 }];
      const saved = await fx.service.saveBellSchedule(fx.owner, { slots: next, schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx);
      expect(saved.slots.map((s) => `${s.position}:${s.label}`)).toEqual(["1:P1", "2:P2", "3:Break", "4:P3", "5:P4", "6:P5"]);
      expect(saved.slots.slice(0, 5).map((s) => s.id)).toEqual(slots.map((s) => s.id));
      await fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: [1, 2, 3, 4, 5] }, reqCtx);
    });
  });
});
