import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

// Phase 8c / CP5b — the question bank tables (questions, question_options)
// are ordinary tenant tables (docs/modules/phase-8.md §22.2). Real Postgres,
// as the runtime role: no GUC sees nothing; a school sees only its own; a
// cross-tenant write is refused by WITH CHECK, with a control write under the
// right GUC succeeding so the refusal is not passing for the wrong reason.
// Exam content is the thing a rival school would most like to read.

describe("Phase 8c CP5b — question bank RLS", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA = "";
  let schoolB = "";
  let levelA = "";
  let subjectA = "";
  let questionA = "";

  beforeAll(async () => {
    schoolA = (await basePrisma.school.create({ data: { name: "QB A", slug: `qb-a-${runId}` }, select: { id: true } })).id;
    schoolB = (await basePrisma.school.create({ data: { name: "QB B", slug: `qb-b-${runId}` }, select: { id: true } })).id;
    await withTenant(schoolA, async (db) => {
      levelA = (await db.classLevel.create({
        data: { schoolId: schoolA, name: "SS 1", code: `ss1-${runId}`, stage: "SSS", orderIndex: 10 },
      })).id;
      subjectA = (await db.subject.create({ data: { schoolId: schoolA, name: "Physics", code: `phy-${runId}` } })).id;
      questionA = (await db.question.create({
        data: {
          schoolId: schoolA,
          subjectId: subjectA,
          classLevelId: levelA,
          topic: "Motion",
          type: "MULTIPLE_CHOICE",
          text: `Secret exam question ${runId}`,
          marks: 1,
          createdBy: "spec",
          options: { create: [{ schoolId: schoolA, orderIndex: 0, text: "A", isCorrect: true }] },
        },
      })).id;
    });
  });

  afterAll(async () => {
    await withTenant(schoolA, async (db) => {
      await db.question.deleteMany({});
      await db.subject.deleteMany({ where: { id: subjectA } });
      await db.classLevel.deleteMany({ where: { id: levelA } });
    });
    for (const id of [schoolA, schoolB]) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  it("with no GUC the runtime role sees no questions or options", async () => {
    expect(await basePrisma.question.count()).toBe(0);
    expect(await basePrisma.questionOption.count()).toBe(0);
  });

  it("school B sees none of school A's questions, even searching for the text", async () => {
    const seen = await withTenant(schoolB, async (db) => ({
      questions: await db.question.count(),
      options: await db.questionOption.count(),
      byText: await db.question.findFirst({ where: { text: { contains: runId } } }),
      byId: await db.question.findUnique({ where: { id: questionA } }),
    }));
    expect(seen).toEqual({ questions: 0, options: 0, byText: null, byId: null });
    expect(await withTenant(schoolA, (db) => db.question.count())).toBe(1);
  });

  it("a write naming another school is refused; the same write for the right school succeeds", async () => {
    await expect(
      withTenant(schoolB, (db) =>
        db.question.create({
          data: { schoolId: schoolA, subjectId: subjectA, classLevelId: levelA, topic: "x", type: "THEORY", text: "x", marks: 1, createdBy: "x" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(schoolB, (db) =>
        db.questionOption.create({ data: { schoolId: schoolA, questionId: questionA, orderIndex: 1, text: "B" } }),
      ),
    ).rejects.toThrow();

    await withTenant(schoolA, (db) =>
      db.questionOption.create({ data: { schoolId: schoolA, questionId: questionA, orderIndex: 1, text: "B" } }),
    );
  });
});
