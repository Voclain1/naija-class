import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

// Phase 8c / CP5c — exam_papers, exam_paper_sections and exam_paper_items are
// ordinary tenant tables (docs/modules/phase-8.md §22.3). Real Postgres, as the
// runtime role: no GUC sees nothing; a school sees only its own papers; a
// cross-tenant write is refused by WITH CHECK, with a control write under the
// right GUC succeeding so the refusal is not passing for the wrong reason.

describe("Phase 8c CP5c — exam paper RLS", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA = "";
  let schoolB = "";
  const A: Record<string, string> = {};

  beforeAll(async () => {
    schoolA = (await basePrisma.school.create({ data: { name: "EP A", slug: `ep-a-${runId}` }, select: { id: true } })).id;
    schoolB = (await basePrisma.school.create({ data: { name: "EP B", slug: `ep-b-${runId}` }, select: { id: true } })).id;
    await withTenant(schoolA, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: schoolA, label: "Y", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
      });
      A.termId = (await db.term.create({
        data: { schoolId: schoolA, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-11") },
      })).id;
      A.levelId = (await db.classLevel.create({ data: { schoolId: schoolA, name: "SS 1", code: `ss1-${runId}`, stage: "SSS", orderIndex: 10 } })).id;
      A.subjectId = (await db.subject.create({ data: { schoolId: schoolA, name: "Physics", code: `phy-${runId}` } })).id;
      A.questionId = (await db.question.create({
        data: { schoolId: schoolA, subjectId: A.subjectId, classLevelId: A.levelId, topic: "Motion", type: "THEORY", text: "Q", marks: 5, createdBy: "spec" },
      })).id;
      const paper = await db.examPaper.create({
        data: {
          schoolId: schoolA, subjectId: A.subjectId, classLevelId: A.levelId, termId: A.termId,
          title: `Secret paper ${runId}`, durationMinutes: 60, createdBy: "spec",
          sections: { create: [{ schoolId: schoolA, orderIndex: 0, title: "Section A" }] },
        },
        include: { sections: true },
      });
      A.paperId = paper.id;
      A.sectionId = paper.sections[0]!.id;
      await db.examPaperItem.create({ data: { schoolId: schoolA, paperId: A.paperId, sectionId: A.sectionId, questionId: A.questionId, orderIndex: 0 } });
    });
  });

  afterAll(async () => {
    await withTenant(schoolA, async (db) => {
      await db.examPaper.deleteMany({}); // DRAFT: deletable; cascades sections and items
      await db.question.deleteMany({});
    });
    for (const id of [schoolA, schoolB]) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
  });

  it("with no GUC the runtime role sees no papers, sections or items", async () => {
    expect(await basePrisma.examPaper.count()).toBe(0);
    expect(await basePrisma.examPaperSection.count()).toBe(0);
    expect(await basePrisma.examPaperItem.count()).toBe(0);
  });

  it("school B sees none of school A's papers", async () => {
    const seen = await withTenant(schoolB, async (db) => ({
      papers: await db.examPaper.count(),
      sections: await db.examPaperSection.count(),
      items: await db.examPaperItem.count(),
      byId: await db.examPaper.findUnique({ where: { id: A.paperId } }),
    }));
    expect(seen).toEqual({ papers: 0, sections: 0, items: 0, byId: null });
    expect(await withTenant(schoolA, (db) => db.examPaper.count())).toBe(1);
  });

  it("a write naming another school is refused; the same write for the right school succeeds", async () => {
    await expect(
      withTenant(schoolB, (db) =>
        db.examPaperSection.create({ data: { schoolId: schoolA, paperId: A.paperId!, orderIndex: 1, title: "Injected" } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(schoolB, (db) =>
        db.examPaper.create({
          data: { schoolId: schoolA, subjectId: A.subjectId!, classLevelId: A.levelId!, termId: A.termId!, title: "x", durationMinutes: 60, createdBy: "x" },
        }),
      ),
    ).rejects.toThrow();
    await withTenant(schoolA, (db) =>
      db.examPaperSection.create({ data: { schoolId: schoolA, paperId: A.paperId!, orderIndex: 1, title: "Section B" } }),
    );
  });
});
