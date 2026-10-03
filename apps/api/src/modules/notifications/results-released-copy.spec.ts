import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { EventNotifierService } from "./event-notifier.service";

// Phase 8c / CP6b — the "results released" notification must not promise a
// card the app will then show locked. In PIN mode it says a PIN is needed;
// FREE keeps the wording families already know.
describe("results released — what the notification says in each access mode", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolId = "";
  let termId = "";
  let armId = "";

  beforeAll(async () => {
    schoolId = (await basePrisma.school.create({ data: { name: `Notify ${runId}`, slug: `ntf-${runId}` }, select: { id: true } })).id;
    await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: "Y", startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      termId = (await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
        select: { id: true },
      })).id;
      const level = await db.classLevel.create({ data: { schoolId, name: "P1", code: `p1-${runId}`, orderIndex: 1, stage: "PRIMARY" }, select: { id: true } });
      armId = (await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "P1 A", code: `p1a-${runId}` }, select: { id: true } })).id;
      const student = await db.student.create({
        data: { schoolId, admissionNumber: `N-${runId}`, firstName: "Ngozi", lastName: "N", dateOfBirth: new Date("2017-01-01"), gender: "FEMALE" },
        select: { id: true },
      });
      const guardian = await db.guardian.create({
        data: { schoolId, firstName: "G", lastName: "N", relationship: "MOTHER", phone: `+23483${String(Date.now()).slice(-8)}` },
        select: { id: true },
      });
      await db.studentGuardian.create({ data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true } });
      await db.reportCard.create({
        data: { schoolId, studentId: student.id, termId, academicYearId: year.id, classArmId: armId, status: "RELEASED", releasedAt: new Date() },
      });
    });
  });

  afterAll(async () => {
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  });

  async function bodies(accessMode: "FREE" | "PIN" | undefined) {
    const notifyOfEvent = vi.fn(async () => undefined);
    const events = new EventNotifierService({ notifyOfEvent } as never, {} as never);
    await events.resultsReleased({ schoolId, termId, classArmId: armId, accessMode });
    const calls = notifyOfEvent.mock.calls as unknown as [{ principal: { type: string }; body: string }][];
    return Object.fromEntries(calls.map(([c]) => [c.principal.type, c.body]));
  }

  it("FREE (and a caller that names no mode) keeps today's wording", async () => {
    const expected = {
      GUARDIAN: "Results have been released. Open the app to see them.",
      STUDENT: "Your results have been released.",
    };
    expect(await bodies("FREE")).toEqual(expected);
    expect(await bodies(undefined)).toEqual(expected);
  });

  it("PIN mode tells the family a result PIN is needed", async () => {
    expect(await bodies("PIN")).toEqual({
      GUARDIAN: "Results have been released. You'll need a result PIN from the school to open them.",
      STUDENT: "Your results have been released. You'll need a result PIN to open them.",
    });
  });
});
