import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, type FamilyTimetableDto } from "@school-kit/types";

import type { TenantDb } from "./timetable-clash";
import { TimetableFamilyReader } from "./timetable-family-reader";
import { createTimetableFixture, MON, TUE, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP4 — published snapshots and THE family reader
// (docs/modules/phase-8.md §18 D39, D45), against a REAL Postgres.
//
// The guarantee under test: families see ONLY what the school published. Proven
// three ways — behaviour (unpublished / edited-after-publish / withdrawn), an
// interception that records every table the reader touches, and (separately,
// recorded in §18) mutation runs against the reader and withdraw.
//
// People in this file:
//   Ada  — enrolled in JSS 1A this term; guardian Grace is linked to her
//   Bola — enrolled in JSS 1B this term; NOT linked to Grace (same school)
//   Chi  — WITHDRAWN this term;  Dayo — no enrollment this term
//   Eze  — a student of ANOTHER school

const reqCtx = { ipAddress: "127.0.0.1" };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("timetable publishing and the family reader (Phase 8 CP4) — real database", () => {
  let fx: TimetableFixture;
  let other: TimetableFixture;
  const reader = new TimetableFamilyReader();
  const people = {} as { ada: string; bola: string; chi: string; dayo: string; grace: string; eze: string };

  async function student(f: TimetableFixture, name: string, arm: "a" | "b" | null, status: "ENROLLED" | "WITHDRAWN" = "ENROLLED"): Promise<string> {
    return withTenant(f.schoolId, async (db) => {
      const s = await db.student.create({
        data: { schoolId: f.schoolId, admissionNumber: `PUB-${name}-${f.runId}`, firstName: name, lastName: "Student", dateOfBirth: d("2014-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      if (arm) {
        await db.enrollment.create({
          data: { schoolId: f.schoolId, studentId: s.id, termId: f.terms.first, academicYearId: f.year, classArmId: f.arms[arm], status },
        });
      }
      return s.id;
    });
  }

  beforeAll(async () => {
    fx = await createTimetableFixture("pub");
    other = await createTimetableFixture("pub-other");
    for (const f of [fx, other]) {
      await withTenant(f.schoolId, (db) => db.term.update({ where: { id: f.terms.first }, data: { isCurrent: true } }));
    }
    people.ada = await student(fx, "Ada", "a");
    people.bola = await student(fx, "Bola", "b");
    people.chi = await student(fx, "Chi", "a", "WITHDRAWN");
    people.dayo = await student(fx, "Dayo", null);
    people.eze = await student(other, "Eze", "a");
    people.grace = await withTenant(fx.schoolId, async (db) => {
      const g = await db.guardian.create({
        data: { schoolId: fx.schoolId, firstName: "Grace", lastName: "Parent", relationship: "MOTHER", email: `grace-${fx.runId}@example.test`, phone: `+23480${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}` },
        select: { id: true },
      });
      await db.studentGuardian.create({ data: { schoolId: fx.schoolId, studentId: people.ada, guardianId: g.id } });
      return g.id;
    });
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
    await other?.cleanup();
  });

  beforeEach(async () => {
    await fx.reset();
    await withTenant(fx.schoolId, (db) => db.timetablePublication.deleteMany({ where: { schoolId: fx.schoolId } }));
  });

  const asStudent = (id: string) => reader.forStudent(fx.schoolId, id);
  const asGrace = (id: string) => reader.forGuardian(fx.schoolId, people.grace, id);
  const lessonsSeen = (r: FamilyTimetableDto) =>
    (r.grid?.lessons ?? []).map((l) => `${l.dayOfWeek}/P${l.slotPosition}/${l.subjectName}/${l.teacherNames.join("+")}`);
  const status = async () => (await fx.service.getView(fx.owner, { classArmId: fx.arms.a, termId: fx.terms.first })).publication;

  async function builtA(): Promise<string> {
    const yw = await fx.timetable("a", null);
    await fx.lesson(yw.id, MON, "p1", [fx.teachers.tunde]);
    return yw.id;
  }

  // ===========================================================================
  // Behaviour
  // ===========================================================================

  it("an UNPUBLISHED timetable is invisible to the student and the guardian", async () => {
    await builtA();
    for (const r of [await asStudent(people.ada), await asGrace(people.ada)]) {
      expect(r).toEqual({ state: "NOT_PUBLISHED", className: "JSS 1A", termName: "First Term", publishedAt: null, grid: null });
    }
    expect(await status()).toEqual({ state: "NOT_PUBLISHED", publishedAt: null });
  });

  it("publish → visible, with display names only and no ids anywhere in what families receive", async () => {
    const yw = await builtA();
    const pub = await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    expect(pub.terms.map((t) => t.name)).toEqual(["First Term", "Second Term", "Third Term"]);

    const seen = await asGrace(people.ada);
    expect(seen.state).toBe("PUBLISHED");
    expect(lessonsSeen(seen)).toEqual(["1/P1/Mathematics/Tunde Bello"]);
    expect(seen.grid!.slots.map((s) => s.label)).toEqual(["P1", "P2", "Break", "P3", "P4"]);
    expect(seen.grid!.days).toEqual([1, 2, 3, 4, 5]);
    const wire = JSON.stringify(seen);
    for (const id of [fx.teachers.tunde, fx.arms.a, fx.subjects.maths, fx.slots.p1, yw]) expect(wire).not.toContain(id);
    expect(await status()).toMatchObject({ state: "UP_TO_DATE" });
  });

  it("an edit AFTER publishing is not seen by families; the builder says 'unpublished changes'; republishing shows it", async () => {
    const yw = await builtA();
    const first = await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    await fx.lesson(yw, TUE, "p2", [fx.teachers.uche]);

    expect(lessonsSeen(await asStudent(people.ada))).toEqual(["1/P1/Mathematics/Tunde Bello"]);
    expect(await status()).toEqual({ state: "UNPUBLISHED_CHANGES", publishedAt: first.publishedAt });

    await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    expect(lessonsSeen(await asStudent(people.ada))).toEqual(["1/P1/Mathematics/Tunde Bello", "2/P2/Mathematics/Uche Eze"]);
    expect(await status()).toMatchObject({ state: "UP_TO_DATE" });
  });

  it("changing period TIMES is also an unpublished change (families see the times they were given)", async () => {
    const yw = await builtA();
    await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    const sched = await fx.service.getBellSchedule(fx.owner);
    const slots = sched.slots.map(({ id, label, kind, startMinute, endMinute }) => ({ id, label, kind, startMinute: startMinute + 5, endMinute: endMinute + 5 }));
    await fx.service.saveBellSchedule(fx.owner, { slots, schoolWeekDays: sched.schoolWeekDays }, reqCtx);
    try {
      expect(await status()).toMatchObject({ state: "UNPUBLISHED_CHANGES" });
      expect((await asStudent(people.ada)).grid!.slots[0]).toMatchObject({ startMinute: 480, endMinute: 520 });
    } finally {
      await fx.service.saveBellSchedule(fx.owner, { slots: slots.map((s) => ({ ...s, startMinute: s.startMinute - 5, endMinute: s.endMinute - 5 })), schoolWeekDays: sched.schoolWeekDays }, reqCtx);
    }
  });

  it("withdraw → 'not published' again; the row is DELETED; a second withdraw is a no-op with no audit row", async () => {
    const yw = await builtA();
    await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    const audits = () => withTenant(fx.schoolId, (db) => db.auditLog.count({ where: { action: "timetable.publication.withdraw" } }));
    const before = await audits();

    await fx.service.withdrawPublication(fx.owner, { classArmId: fx.arms.a, termId: fx.terms.first }, reqCtx);
    expect((await asGrace(people.ada)).state).toBe("NOT_PUBLISHED");
    expect(await withTenant(fx.schoolId, (db) => db.timetablePublication.count({ where: { classArmId: fx.arms.a, termId: fx.terms.first } }))).toBe(0);
    await fx.service.withdrawPublication(fx.owner, { classArmId: fx.arms.a, termId: fx.terms.first }, reqCtx);
    expect(await audits()).toBe(before + 1);
    // The other terms' publications are untouched.
    expect(await withTenant(fx.schoolId, (db) => db.timetablePublication.count({ where: { classArmId: fx.arms.a } }))).toBe(2);
  });

  it("publish is REFUSED while the class is in a clash (every clash listed), and for an empty timetable", async () => {
    const empty = await fx.timetable("c", null);
    await expect(fx.service.publishTimetable(fx.owner, empty.id, reqCtx)).rejects.toMatchObject({ code: "NOTHING_TO_PUBLISH" });

    // A clash can exist only from an academic-structure change (D43); build it directly.
    const a = await builtA();
    const b = await fx.timetable("b", null);
    await withTenant(fx.schoolId, async (db) => {
      const e = await db.timetableEntry.create({
        data: { schoolId: fx.schoolId, timetableId: b.id, dayOfWeek: MON, bellSlotId: fx.slots.p1, subjectId: fx.subjects.maths, updatedBy: fx.owner.userId },
        select: { id: true },
      });
      await db.timetableEntryTeacher.create({ data: { schoolId: fx.schoolId, entryId: e.id, teacherId: fx.teachers.tunde } });
    });
    const err = (await fx.service.publishTimetable(fx.owner, a, reqCtx).catch((e: unknown) => e)) as { code: string; details: { clashes: unknown[] } };
    expect(err.code).toBe("PUBLISH_BLOCKED_BY_CLASH");
    expect(err.details.clashes).toHaveLength(3); // Mon P1, one per term
    expect(await withTenant(fx.schoolId, (db) => db.timetablePublication.count())).toBe(0);
  });

  it("a whole-year publish writes one snapshot per term it is in force — none for a term it is replaced in; the override publishes its own", async () => {
    const yw = await builtA();
    const t2 = await fx.timetable("a", fx.terms.second);
    await fx.lesson(t2.id, TUE, "p1", [fx.teachers.tunde]);

    expect((await fx.service.publishTimetable(fx.owner, yw, reqCtx)).terms.map((t) => t.name)).toEqual(["First Term", "Third Term"]);
    expect((await fx.service.publishTimetable(fx.owner, t2.id, reqCtx)).terms.map((t) => t.name)).toEqual(["Second Term"]);
    const rows = await withTenant(fx.schoolId, (db) =>
      db.timetablePublication.findMany({ where: { classArmId: fx.arms.a }, select: { termId: true, grid: true } }),
    );
    const byTerm = new Map(rows.map((r) => [r.termId, (r.grid as { lessons: Array<{ dayOfWeek: number }> }).lessons.map((l) => l.dayOfWeek)]));
    expect(byTerm.get(fx.terms.first)).toEqual([MON]);
    expect(byTerm.get(fx.terms.second)).toEqual([TUE]);
    expect(byTerm.get(fx.terms.third)).toEqual([MON]);

    // A whole-year timetable replaced in EVERY term cannot be published at all.
    for (const termId of [fx.terms.first, fx.terms.third]) await fx.service.forkTimetable(fx.owner, yw, { termId }, reqCtx);
    await expect(fx.service.publishTimetable(fx.owner, yw, reqCtx)).rejects.toMatchObject({ code: "NOTHING_TO_PUBLISH" });
  });

  // ===========================================================================
  // Negative walks — family separation is the link check, not RLS
  // ===========================================================================

  describe("who may see what", () => {
    beforeEach(async () => {
      const yw = await builtA();
      await fx.service.publishTimetable(fx.owner, yw, reqCtx);
      const b = await fx.timetable("b", null);
      await fx.lesson(b.id, TUE, "p1", [fx.teachers.tunde]);
      await fx.service.publishTimetable(fx.owner, b.id, reqCtx);
    });

    it("a student sees only their own class", async () => {
      expect((await asStudent(people.ada)).className).toBe("JSS 1A");
      expect((await asStudent(people.bola)).className).toBe("JSS 1B");
    });

    it("a guardian asking for an UNLINKED child in the SAME school → 403; the linked control succeeds", async () => {
      await expect(asGrace(people.bola)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(asGrace(people.ada)).resolves.toMatchObject({ state: "PUBLISHED", className: "JSS 1A" });
    });

    it("a student of another school → 404 through the guardian path; nothing of theirs is reachable from this school", async () => {
      await expect(asGrace(people.eze)).rejects.toBeInstanceOf(NotFoundError);
      await expect(reader.forStudent(fx.schoolId, people.eze)).resolves.toMatchObject({ state: "NOT_ENROLLED" });
    });

    it("withdrawn, not enrolled, no current term, and a deactivated class → each an explicit empty state, never an error or an old class", async () => {
      expect(await asStudent(people.chi)).toEqual({ state: "NOT_ENROLLED", className: null, termName: "First Term", publishedAt: null, grid: null });
      expect((await asStudent(people.dayo)).state).toBe("NOT_ENROLLED");

      await withTenant(fx.schoolId, (db) => db.classArm.update({ where: { id: fx.arms.a }, data: { isActive: false } }));
      try {
        expect(await asStudent(people.ada)).toMatchObject({ state: "NOT_PUBLISHED", grid: null });
      } finally {
        await withTenant(fx.schoolId, (db) => db.classArm.update({ where: { id: fx.arms.a }, data: { isActive: true } }));
      }

      await withTenant(fx.schoolId, (db) => db.term.update({ where: { id: fx.terms.first }, data: { isCurrent: false } }));
      try {
        expect((await asStudent(people.ada)).state).toBe("NO_CURRENT_TERM");
      } finally {
        await withTenant(fx.schoolId, (db) => db.term.update({ where: { id: fx.terms.first }, data: { isCurrent: true } }));
      }
    });
  });

  // ===========================================================================
  // Structural: the reader never touches a live timetable table
  // ===========================================================================

  it("INTERCEPTION: every table the family reader queries is recorded — no live timetable table, no raw SQL", async () => {
    const yw = await builtA();
    await fx.service.publishTimetable(fx.owner, yw, reqCtx);
    await fx.lesson(yw, TUE, "p2", [fx.teachers.uche]); // an unpublished edit exists

    const touched = new Set<string>();
    const recording = (db: TenantDb): TenantDb =>
      new Proxy(db, {
        get(target, prop, receiver) {
          if (typeof prop === "string" && !prop.startsWith("_") && prop !== "then") touched.add(prop);
          return Reflect.get(target, prop, receiver);
        },
      });

    for (const studentId of [people.ada, people.bola, people.chi, people.dayo]) {
      await withTenant(fx.schoolId, (db) => reader.classWeek(recording(db), fx.schoolId, studentId));
    }
    expect([...touched].sort()).toEqual(["enrollment", "term", "timetablePublication"]);
    for (const live of ["timetable", "timetableEntry", "timetableEntryTeacher", "bellSlot", "$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]) {
      expect(touched.has(live), `family reader touched ${live}`).toBe(false);
    }
  });
});
