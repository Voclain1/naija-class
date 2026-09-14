import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTenant } from "@school-kit/db";
import type { CopyProblemsDto, CopyResultDto, LessonDto } from "@school-kit/types";

import { createTimetableFixture, MON, TUE, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP4 — fork and copy-forward (docs/modules/phase-8.md §18 D41, D42, Q42),
// against a REAL Postgres. Every case checks the database afterwards, not only the
// response: "refused" must mean nothing was written.
//
// Fixture assignments that matter here (timetable.fixture-spec.ts):
//   Tunde  Maths × 1A, 1B, 1C for year Y; Maths × 1A, 1B for year Y2
//   Uche   Maths × 1A, 1B for Y; English × 1A for Y's First Term ONLY; nothing in Y2

const WED = 3;
const reqCtx = { ipAddress: "127.0.0.1" };

type Refusal = { code: string; message: string; details: CopyProblemsDto };

const shape = (lessons: LessonDto[]) =>
  lessons.map((l) => ({ dayOfWeek: l.dayOfWeek, bellSlotId: l.bellSlotId, subjectId: l.subjectId, teachers: l.teachers.map((t) => t.id) }));

describe("timetable fork and copy (Phase 8 CP4) — real database", () => {
  let fx: TimetableFixture;

  beforeAll(async () => {
    fx = await createTimetableFixture("life");
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(async () => {
    await fx.reset();
  });

  const lessonsIn = (timetableId: string) =>
    withTenant(fx.schoolId, (db) =>
      db.timetableEntry.findMany({
        where: { timetableId },
        orderBy: [{ dayOfWeek: "asc" }, { bellSlot: { position: "asc" } }],
        select: { dayOfWeek: true, bellSlotId: true, subjectId: true, teachers: { select: { teacherId: true }, orderBy: { teacherId: "asc" } } },
      }),
    );
  const timetableFor = (arm: "a" | "b" | "c", termId: string | null, yearId = fx.year) =>
    withTenant(fx.schoolId, (db) => db.timetable.findFirst({ where: { classArmId: fx.arms[arm], academicYearId: yearId, termId }, select: { id: true } }));
  const auditCount = (action: string) => withTenant(fx.schoolId, (db) => db.auditLog.count({ where: { action } }));
  const refusalOf = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a refusal"); }, (e: unknown) => e as Refusal);

  // ===========================================================================
  // Fork (D41)
  // ===========================================================================

  describe("fork", () => {
    it("copies every lesson and teacher of the whole-year timetable into a new term timetable", async () => {
      const yw = await fx.timetable("a", null);
      await fx.lesson(yw.id, MON, "p1", [fx.teachers.tunde]);
      await fx.lesson(yw.id, TUE, "p3", [fx.teachers.tunde, fx.teachers.uche], { span: 2 });
      const before = await auditCount("timetable.fork");

      const r = await fx.service.forkTimetable(fx.owner, yw.id, { termId: fx.terms.second }, reqCtx);

      expect(r.ok).toBe(true);
      expect(r.timetable).toMatchObject({ classArmId: fx.arms.a, termId: fx.terms.second });
      expect(r.lessonsCopied).toBe(3);
      expect(await lessonsIn(r.timetable!.id)).toEqual(await lessonsIn(yw.id));
      expect(await auditCount("timetable.fork")).toBe(before + 1);
    });

    it("refuses when the term already has a timetable (never overwrites), a term-only source, and a term from another year", async () => {
      const yw = await fx.timetable("a", null);
      await fx.lesson(yw.id, MON, "p1", [fx.teachers.tunde]);
      const t2 = await fx.timetable("a", fx.terms.second);
      await fx.lesson(t2.id, TUE, "p1", [fx.teachers.tunde]);

      await expect(fx.service.forkTimetable(fx.owner, yw.id, { termId: fx.terms.second }, reqCtx)).rejects.toMatchObject({ code: "TIMETABLE_EXISTS" });
      expect(await lessonsIn(t2.id)).toHaveLength(1); // untouched
      await expect(fx.service.forkTimetable(fx.owner, t2.id, { termId: fx.terms.third }, reqCtx)).rejects.toMatchObject({ code: "NOT_YEAR_WIDE" });
      await expect(fx.service.forkTimetable(fx.owner, yw.id, { termId: fx.year2Term }, reqCtx)).rejects.toMatchObject({ code: "TERM_NOT_IN_YEAR" });
    });

    it("refuses when copied teachers are not assigned for the term, listing EVERY one, and writes nothing", async () => {
      // Uche teaches English in 1A for First Term only; the whole-year timetable
      // saves with a warning (D33). Forking into Second Term leaves both lessons
      // without an effective assignment.
      const yw = await fx.timetable("a", null);
      await fx.lesson(yw.id, MON, "p1", [fx.teachers.uche], { subject: "english" });
      await fx.lesson(yw.id, WED, "p2", [fx.teachers.uche], { subject: "english" });

      const err = await refusalOf(fx.service.forkTimetable(fx.owner, yw.id, { termId: fx.terms.second }, reqCtx));
      expect(err.code).toBe("TIMETABLE_COPY_REFUSED");
      expect(err.details.unassignedTeachers.map((u) => `${u.teacherName}/${u.subjectName}/${u.dayOfWeek}/${u.slotLabel}`)).toEqual([
        "Uche Eze/English/1/P1",
        "Uche Eze/English/3/P2",
      ]);
      expect(await timetableFor("a", fx.terms.second)).toBeNull();
    });
  });

  // ===========================================================================
  // Copy (D42)
  // ===========================================================================

  describe("copy", () => {
    it("into a NON-EMPTY destination → refused with the count; the destination is untouched", async () => {
      const src = await fx.timetable("a", fx.terms.first);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      const dest = await fx.timetable("a", fx.terms.third);
      await fx.lesson(dest.id, TUE, "p2", [fx.teachers.tunde]);
      await fx.lesson(dest.id, WED, "p2", [fx.teachers.tunde]);

      const err = await refusalOf(fx.service.copyTimetable(fx.owner, src.id, { academicYearId: fx.year, termId: fx.terms.third, leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] }, reqCtx));
      expect(err.code).toBe("TIMETABLE_COPY_REFUSED");
      expect(err.details).toMatchObject({ destinationLessonCount: 2, clashesChecked: false });
      expect(err.message).toContain("already has 2 lessons");
      expect((await lessonsIn(dest.id)).map((l) => l.dayOfWeek)).toEqual([TUE, WED]);
    });

    it("that would clash → refused listing EVERY clash; nothing is written", async () => {
      const src = await fx.timetable("a", fx.terms.first);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      await fx.lesson(src.id, TUE, "p1", [fx.teachers.tunde]);
      const b3 = await fx.timetable("b", fx.terms.third);
      await fx.lesson(b3.id, MON, "p1", [fx.teachers.tunde]);
      await fx.lesson(b3.id, TUE, "p1", [fx.teachers.tunde]);

      const err = await refusalOf(fx.service.copyTimetable(fx.owner, src.id, { academicYearId: fx.year, termId: fx.terms.third, leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] }, reqCtx));
      expect(err.details.clashesChecked).toBe(true);
      expect(err.details.clashes.map((c) => `${c.teacherName}/${c.dayOfWeek}/${c.slotLabel}/${c.termName}`)).toEqual([
        "Tunde Bello/1/P1/Third Term",
        "Tunde Bello/2/P1/Third Term",
      ]);
      expect(await timetableFor("a", fx.terms.third)).toBeNull();
    });

    it("with several problems → ALL of them reported together (unassigned teacher AND clash)", async () => {
      const src = await fx.timetable("a", fx.terms.first);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      await fx.lesson(src.id, WED, "p1", [fx.teachers.uche], { subject: "english" }); // First-Term-only assignment
      const b3 = await fx.timetable("b", fx.terms.third);
      await fx.lesson(b3.id, MON, "p1", [fx.teachers.tunde]);

      const err = await refusalOf(fx.service.copyTimetable(fx.owner, src.id, { academicYearId: fx.year, termId: fx.terms.third, leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] }, reqCtx));
      expect(err.details.destinationLessonCount).toBe(0);
      expect(err.details.unassignedTeachers.map((u) => u.teacherName)).toEqual(["Uche Eze"]);
      expect(err.details.clashes.map((c) => c.teacherName)).toEqual(["Tunde Bello"]);
      expect(err.message).toContain("1 teacher is not assigned");
      expect(err.message).toContain("1 clash");
    });

    it("PREVIEW runs the same path and rolls back: its lessons equal what the real copy writes, and the preview writes nothing", async () => {
      const src = await fx.timetable("a", null);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      await fx.lesson(src.id, TUE, "p3", [fx.teachers.tunde], { span: 2 });
      const input = { academicYearId: fx.year2, termId: null, leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] };
      const copiesBefore = await auditCount("timetable.copy");

      const preview = await fx.service.copyTimetable(fx.owner, src.id, input, reqCtx, { preview: true });
      expect(preview).toMatchObject({ preview: true, ok: true, timetable: null, lessonsCopied: 3 });
      expect(preview.lessons).toHaveLength(3);
      expect(await timetableFor("a", null, fx.year2)).toBeNull(); // not even the header survived
      expect(await auditCount("timetable.copy")).toBe(copiesBefore);

      const real = await fx.service.copyTimetable(fx.owner, src.id, input, reqCtx);
      expect(real.ok).toBe(true);
      expect(shape(real.lessons)).toEqual(shape(preview.lessons));
      expect(shape(real.lessons)).toEqual(
        (await lessonsIn(real.timetable!.id)).map((l) => ({ dayOfWeek: l.dayOfWeek, bellSlotId: l.bellSlotId, subjectId: l.subjectId, teachers: l.teachers.map((t) => t.teacherId) })),
      );
      expect(await auditCount("timetable.copy")).toBe(copiesBefore + 1);
    });

    describe("leaving unassigned teachers off (Q42)", () => {
      async function source(): Promise<string> {
        // Into year Y2, where Uche has NO assignment: the co-taught Tuesday lesson
        // would keep Tunde and lose Uche.
        const src = await fx.timetable("a", null);
        await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
        await fx.lesson(src.id, TUE, "p2", [fx.teachers.tunde, fx.teachers.uche]);
        return src.id;
      }
      const into = (extra: Partial<{ leaveUnassignedTeachersOff: boolean; acknowledgedRemovals: Array<{ dayOfWeek: number; bellSlotId: string; teacherId: string }> }>) => ({
        academicYearId: fx.year2,
        termId: null,
        leaveUnassignedTeachersOff: false,
        acknowledgedRemovals: [] as Array<{ dayOfWeek: number; bellSlotId: string; teacherId: string }>,
        ...extra,
      });

      it("without the option → refused, naming the teacher", async () => {
        const src = await source();
        const err = await refusalOf(fx.service.copyTimetable(fx.owner, src, into({}), reqCtx));
        expect(err.details.unassignedTeachers).toEqual([
          expect.objectContaining({ dayOfWeek: TUE, bellSlotId: fx.slots.p2, teacherId: fx.teachers.uche, teacherName: "Uche Eze" }),
        ]);
      });

      it("with EXACTLY the previewed removals acknowledged → copied without that teacher; the removal is reported and audited", async () => {
        const src = await source();
        const preview = await fx.service.copyTimetable(fx.owner, src, into({}), reqCtx, { preview: true });
        const ack = preview.problems.unassignedTeachers.map(({ dayOfWeek, bellSlotId, teacherId }) => ({ dayOfWeek, bellSlotId, teacherId }));

        const r = await fx.service.copyTimetable(fx.owner, src, into({ leaveUnassignedTeachersOff: true, acknowledgedRemovals: ack }), reqCtx);
        expect(r.ok).toBe(true);
        expect(r.removedTeachers.map((x) => x.teacherName)).toEqual(["Uche Eze"]);
        const copied = await lessonsIn(r.timetable!.id);
        expect(copied.map((l) => ({ day: l.dayOfWeek, teachers: l.teachers.map((t) => t.teacherId) }))).toEqual([
          { day: MON, teachers: [fx.teachers.tunde] },
          { day: TUE, teachers: [fx.teachers.tunde] },
        ]);
        const audit = await withTenant(fx.schoolId, (db) => db.auditLog.findFirst({ where: { action: "timetable.copy", entityId: r.timetable!.id }, select: { metadata: true } }));
        expect(audit?.metadata).toMatchObject({ removedTeachers: [{ dayOfWeek: TUE, bellSlotId: fx.slots.p2, teacherId: fx.teachers.uche }] });
      });

      it("with a STALE or wrong acknowledgement → refused (acknowledgementMismatch), nothing written", async () => {
        const src = await source();
        const wrong = [{ dayOfWeek: MON, bellSlotId: fx.slots.p1, teacherId: fx.teachers.tunde }];
        const err = await refusalOf(fx.service.copyTimetable(fx.owner, src, into({ leaveUnassignedTeachersOff: true, acknowledgedRemovals: wrong }), reqCtx));
        expect(err.details.acknowledgementMismatch).toBe(true);
        const none = await refusalOf(fx.service.copyTimetable(fx.owner, src, into({ leaveUnassignedTeachersOff: true, acknowledgedRemovals: [] }), reqCtx));
        expect(none.details.acknowledgementMismatch).toBe(true);
        expect(await timetableFor("a", null, fx.year2)).toBeNull();
      });
    });

    it("onto itself → SAME_AS_SOURCE; into a year with no terms → YEAR_HAS_NO_TERMS", async () => {
      const src = await fx.timetable("a", null);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      const base = { leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] };
      await expect(fx.service.copyTimetable(fx.owner, src.id, { ...base, academicYearId: fx.year, termId: null }, reqCtx)).rejects.toMatchObject({ code: "SAME_AS_SOURCE" });
      await expect(fx.service.copyTimetable(fx.owner, src.id, { ...base, academicYearId: fx.yearNoTerms, termId: null }, reqCtx)).rejects.toMatchObject({ code: "YEAR_HAS_NO_TERMS" });
    });

    it("a copy of an existing EMPTY destination fills it (the header is reused, not duplicated)", async () => {
      const src = await fx.timetable("a", fx.terms.first);
      await fx.lesson(src.id, MON, "p1", [fx.teachers.tunde]);
      const dest = await fx.timetable("a", fx.terms.third);
      const r: CopyResultDto = await fx.service.copyTimetable(fx.owner, src.id, { academicYearId: fx.year, termId: fx.terms.third, leaveUnassignedTeachersOff: false, acknowledgedRemovals: [] }, reqCtx);
      expect(r.timetable?.id).toBe(dest.id);
      expect(await lessonsIn(dest.id)).toHaveLength(1);
    });
  });
});
