import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "@school-kit/db";
import type { TimetableClashDto } from "@school-kit/types";

import { ClassArmsService } from "../class-arms/class-arms.service";
import { TermsService } from "../terms/terms.service";
import { createTimetableFixture, MON, TUE, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP4 — clashes that come into force WITHOUT a timetable edit
// (docs/modules/phase-8.md §18 D43, D44), against a REAL Postgres.
//
// THE SCENARIO (a year "YL" built here, with First and Second Term only):
//   JSS 1A whole-year: Tunde, Monday P1 — but 1A has its own (empty) timetable
//                      for BOTH terms, so that lesson is in force nowhere;
//   JSS 1B whole-year: Tunde, Monday P1 — in force in both terms.
//   No clash exists. Then the school ADDS Third Term: both whole-year timetables
//   come into force for it, and the clash is real.

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("latent timetable clashes (Phase 8 CP4) — real database", () => {
  let fx: TimetableFixture;
  let yl: string;
  let ylTerm1: string;
  let ylTerm2: string;
  const terms = new TermsService();
  const classArms = new ClassArmsService();

  beforeAll(async () => {
    fx = await createTimetableFixture("latent");
    ({ yl, ylTerm1, ylTerm2 } = await withTenant(fx.schoolId, async (db) => {
      const y = await db.academicYear.create({ data: { schoolId: fx.schoolId, label: `YL-${fx.runId}`, startDate: d("2030-09-02"), endDate: d("2031-07-25") }, select: { id: true } });
      const t1 = await db.term.create({ data: { schoolId: fx.schoolId, academicYearId: y.id, sequence: 1, name: "First Term", startDate: d("2030-09-02"), endDate: d("2030-12-13") }, select: { id: true } });
      const t2 = await db.term.create({ data: { schoolId: fx.schoolId, academicYearId: y.id, sequence: 2, name: "Second Term", startDate: d("2031-01-06"), endDate: d("2031-04-04") }, select: { id: true } });
      await db.teacherAssignment.createMany({
        data: (["a", "b", "c"] as const).map((arm) => ({
          schoolId: fx.schoolId, teacherId: fx.teachers.tunde, classArmId: fx.arms[arm], subjectId: fx.subjects.maths, academicYearId: y.id, termId: null,
        })),
      });
      return { yl: y.id, ylTerm1: t1.id, ylTerm2: t2.id };
    }));
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  const banner = () => fx.service.getYearClashes(fx.owner, yl);
  const describeClashes = (cs: TimetableClashDto[]) =>
    cs.map((c) => `${c.teacherName}/${c.dayOfWeek}/${c.slotLabel}/${c.termName}/${c.classArms.map((a) => a.name).join("+")}`);

  it("adding a term that brings a clash into force: the term IS created and the clash is returned, audited, and in the banner", async () => {
    const a = await fx.timetable("a", null, yl);
    await fx.lesson(a.id, MON, "p1", [fx.teachers.tunde]);
    await fx.timetable("a", ylTerm1, yl);
    await fx.timetable("a", ylTerm2, yl);
    const b = await fx.timetable("b", null, yl);
    await fx.lesson(b.id, MON, "p1", [fx.teachers.tunde]); // fine: 1A's lesson is in force nowhere
    expect(await banner()).toEqual([]);

    const created = await terms.create(fx.owner, yl, { sequence: 3, name: "Third Term", startDate: d("2031-04-28"), endDate: d("2031-07-25") }, reqCtx);

    expect(created.name).toBe("Third Term");
    expect(describeClashes(created.timetableClashes!)).toEqual(["Tunde Bello/1/P1/Third Term/JSS 1A+JSS 1B"]);
    expect(describeClashes(await banner())).toEqual(["Tunde Bello/1/P1/Third Term/JSS 1A+JSS 1B"]);
    const audit = await withTenant(fx.schoolId, (db) => db.auditLog.findFirst({ where: { action: "term.create", entityId: created.id }, select: { metadata: true } }));
    expect(audit?.metadata).toMatchObject({ timetableClashesAdded: 1 });
  });

  it("while that clash stands: an unrelated edit is ALLOWED, a third class joining the clash is REFUSED, and the fix is ALLOWED", async () => {
    const b = await withTenant(fx.schoolId, (db) => db.timetable.findFirst({ where: { classArmId: fx.arms.b, academicYearId: yl, termId: null }, select: { id: true } }));
    const thirdTerm = (await banner())[0]!.termId;

    // Unrelated edit — under "no clash may exist" this would be refused.
    await expect(fx.lesson(b!.id, TUE, "p2", [fx.teachers.tunde])).resolves.toBeDefined();

    // 1C joining Monday P1 changes the clash's class set → a NEW clash → refused.
    const c = await fx.timetable("c", null, yl);
    const err = (await fx.lesson(c.id, MON, "p1", [fx.teachers.tunde]).catch((e: unknown) => e)) as { code: string; details: { clashes: TimetableClashDto[] } };
    expect(err.code).toBe("TIMETABLE_CLASH");
    expect(describeClashes(err.details.clashes)).toContain("Tunde Bello/1/P1/Third Term/JSS 1A+JSS 1B+JSS 1C");

    // The fix: give 1A its own Third Term timetable. Allowed, and the clash is gone.
    await expect(fx.timetable("a", thirdTerm, yl)).resolves.toBeDefined();
    expect(await banner()).toEqual([]);
  });

  it("D44: a DEACTIVATED class no longer blocks its teachers; RE-ACTIVATING it returns the clash it brings back, audited", async () => {
    await fx.reset();
    const b = await fx.timetable("b", null);
    await fx.lesson(b.id, MON, "p2", [fx.teachers.tunde]);

    await classArms.update(fx.owner, fx.arms.b, { isActive: false }, reqCtx);
    const a = await fx.timetable("a", null);
    // Before D44 this was refused, naming a class the builder no longer lists.
    await expect(fx.lesson(a.id, MON, "p2", [fx.teachers.tunde])).resolves.toBeDefined();

    const reactivated = await classArms.update(fx.owner, fx.arms.b, { isActive: true }, reqCtx);
    expect(reactivated.isActive).toBe(true);
    expect(describeClashes(reactivated.timetableClashes!)).toEqual([
      "Tunde Bello/1/P2/First Term/JSS 1A+JSS 1B",
      "Tunde Bello/1/P2/Second Term/JSS 1A+JSS 1B",
      "Tunde Bello/1/P2/Third Term/JSS 1A+JSS 1B",
    ]);
    const audit = await withTenant(fx.schoolId, (db) =>
      db.auditLog.findFirst({ where: { action: "class-arm.update", entityId: fx.arms.b }, orderBy: { createdAt: "desc" }, select: { metadata: true } }),
    );
    expect(audit?.metadata).toMatchObject({ timetableClashesAdded: 3 });
  });

  it("an ordinary term create or class update carries no clash noise", async () => {
    const plain = await classArms.update(fx.owner, fx.arms.c, { capacity: 40 }, reqCtx);
    expect(plain.timetableClashes).toBeUndefined();
    const y = await withTenant(fx.schoolId, (db) =>
      db.academicYear.create({ data: { schoolId: fx.schoolId, label: `YQ-${fx.runId}`, startDate: d("2035-09-03"), endDate: d("2036-07-25") }, select: { id: true } }),
    );
    const t = await terms.create(fx.owner, y.id, { sequence: 1, name: "First Term", startDate: d("2035-09-03"), endDate: d("2035-12-14") }, reqCtx);
    expect(t.timetableClashes).toEqual([]);
  });
});
