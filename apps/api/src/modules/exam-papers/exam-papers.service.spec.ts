import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError, optionOrderFor, versionsOf } from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { EmbeddingService } from "../../common/embeddings/embedding.service.js";
import { AuthService } from "../auth/auth.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { QuestionBankService } from "../question-bank/question-bank.service.js";
import { ExamPapersService } from "./exam-papers.service.js";

// Phase 8c / CP5c — exam papers, against real Postgres. The risks:
//   * a FINAL paper must never change — the service refuses AND the database
//     refuses, because a printed paper and its stored record must agree;
//   * only approved questions of the paper's own subject and level go in;
//   * each version's marking scheme must name the right letter for the
//     shuffled options, every time it is printed;
//   * D62 scope, as for the bank.

const runId = Math.random().toString(36).slice(2, 8);
const meta = { ipAddress: "127.0.0.1" };
const ctx = (schoolId: string, userId: string) => ({ sessionId: `sess-${runId}`, schoolId, userId });
const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;

describe("optionOrderFor (versions A–D)", () => {
  it("version A is the order the teacher set; other versions are deterministic real shuffles", () => {
    expect(optionOrderFor("A", "paper:item", 4)).toEqual([0, 1, 2, 3]);
    for (const v of ["B", "C", "D"] as const) {
      const order = optionOrderFor(v, "paper:item", 4);
      expect([...order].sort()).toEqual([0, 1, 2, 3]);
      expect(order).not.toEqual([0, 1, 2, 3]);
      expect(optionOrderFor(v, "paper:item", 4)).toEqual(order); // reprint = same paper
    }
    // Different questions move independently.
    const orders = new Set(Array.from({ length: 12 }, (_, i) => optionOrderFor("B", `paper:item-${i}`, 4).join("")));
    expect(orders.size).toBeGreaterThan(1);
    expect(optionOrderFor("C", "x", 1)).toEqual([0]);
    expect(versionsOf(3)).toEqual(["A", "B", "C"]);
    expect(versionsOf(9)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("ExamPapersService (integration)", () => {
  const bank = new QuestionBankService(
    new AiGenerationService(configStub(), { create: async () => ({ text: "", inputTokens: 0, outputTokens: 0, stopReason: "end_turn" }) }),
    new CurriculumRetrievalService(new EmbeddingService(configStub())),
  );
  const service = new ExamPapersService(bank);
  let S: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    outsiderId: string;
    levelId: string;
    armId: string;
    physicsId: string;
    chemistryId: string;
    termId: string;
    examComponentId: string;
    mcqIds: string[];
    theoryId: string;
    draftId: string;
    chemistryQuestionId: string;
  };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Papers ${runId}`,
        schoolSlug: `papers-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `papers-${runId}@example.test`,
        ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    const owner = ctx(schoolId, signed.user.id);

    const base = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-11") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "Gold", code: `ep-${runId}` } });
      const physics = await db.subject.create({ data: { schoolId, name: `Physics ${runId}`, code: `PHY-${runId}` } });
      const chemistry = await db.subject.create({ data: { schoolId, name: `Chemistry ${runId}`, code: `CHE-${runId}` } });
      const teacherRole = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });
      const makeTeacher = async (email: string, firstName: string) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Teacher" } });
        await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        return user.id;
      };
      const teacherId = await makeTeacher(`ep-t-${runId}@example.test`, "Tunde");
      const outsiderId = await makeTeacher(`ep-o-${runId}@example.test`, "Ngozi");
      await db.teacherAssignment.create({
        data: { schoolId, teacherId, classArmId: arm.id, subjectId: physics.id, academicYearId: year.id, isActive: true },
      });
      const scheme = await db.gradingScheme.findFirst({ where: { schoolId }, select: { id: true } });
      const exam = scheme
        ? await db.gradingComponent.findFirst({ where: { schemeId: scheme.id, key: "exam" }, select: { id: true } })
        : null;
      return { year, term, level, arm, physics, chemistry, teacherId, outsiderId, examComponentId: exam?.id ?? "" };
    });

    // Approved questions through the bank's own service: 3 MCQ (1 mark) and 1 theory (10).
    const make = async (input: Parameters<QuestionBankService["create"]>[1], approve = true) => {
      const q = await bank.create(owner, input, meta);
      return approve ? (await bank.approve(owner, q.id, meta)).id : q.id;
    };
    const physicsAt = { subjectId: base.physics.id, classLevelId: base.level.id };
    const mcq = (text: string) => ({
      ...physicsAt,
      topic: "Motion",
      type: "MULTIPLE_CHOICE" as const,
      difficulty: "MEDIUM" as const,
      text,
      marks: 1,
      answerGuide: null,
      options: ["Speed", "Velocity", "Mass", "Time"].map((t, i) => ({ text: `${t} ${text}`, isCorrect: i === 1 })),
    });
    const mcqIds = [await make(mcq("Q1")), await make(mcq("Q2")), await make(mcq("Q3"))];
    const theoryId = await make({
      ...physicsAt,
      topic: "Motion",
      type: "THEORY",
      difficulty: "HARD",
      text: "Derive v = u + at.",
      marks: 10,
      answerGuide: "Definition of acceleration, rearranged.",
      options: [],
    });
    const draftId = await make(mcq("Draft only"), false);
    const chemistryQuestionId = await make({ ...mcq("Chem"), subjectId: base.chemistry.id });

    S = {
      schoolId,
      ownerId: signed.user.id,
      teacherId: base.teacherId,
      outsiderId: base.outsiderId,
      levelId: base.level.id,
      armId: base.arm.id,
      physicsId: base.physics.id,
      chemistryId: base.chemistry.id,
      termId: base.term.id,
      examComponentId: base.examComponentId,
      mcqIds,
      theoryId,
      draftId,
      chemistryQuestionId,
    };
  });

  afterAll(async () => {
    if (!S) return;
    // FINAL papers are frozen by trigger even against delete, so this run's
    // papers stay behind in the test database, scoped to a school id nothing
    // else uses — the same leftover every spec here accepts on school delete.
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
  });

  const teacher = () => ctx(S.schoolId, S.teacherId);
  const owner = () => ctx(S.schoolId, S.ownerId);
  const outsider = () => ctx(S.schoolId, S.outsiderId);
  const newPaper = (who = teacher()) =>
    service.create(
      who,
      {
        subjectId: S.physicsId,
        classLevelId: S.levelId,
        termId: S.termId,
        title: `Physics exam ${runId}`,
        durationMinutes: 90,
        instructions: "Answer all questions in Section A.",
        componentId: S.examComponentId || null,
        versionCount: 3,
      },
      meta,
    );
  const header = { title: "Physics exam", durationMinutes: 90, instructions: null, componentId: null, versionCount: 3 };

  it("a new paper starts as a DRAFT with Objectives and Theory sections; scope holds", async () => {
    const paper = await newPaper();
    expect(paper).toMatchObject({ status: "DRAFT", totalMarks: 0, questionCount: 0 });
    expect(paper.sections.map((s) => s.title)).toEqual(["Section A — Objectives", "Section B — Theory"]);
    expect(paper.problems).toContain("Add at least one question before finalising.");

    await expect(service.get(outsider(), paper.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await service.list(outsider(), {})).toEqual([]);
    await expect(
      service.create(outsider(), { subjectId: S.physicsId, classLevelId: S.levelId, termId: S.termId, title: "x", durationMinutes: 60, versionCount: 1 }, meta),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only approved questions of the paper's own subject and level go in; marks are computed", async () => {
    const paper = await newPaper();
    const save = (ids: string[]) =>
      service.save(teacher(), paper.id, { ...header, sections: [{ title: "Section A", questionIds: ids }] }, meta);

    await expect(save([S.draftId])).rejects.toBeInstanceOf(ValidationError);
    await expect(save([S.chemistryQuestionId])).rejects.toBeInstanceOf(ValidationError);

    const saved = await service.save(
      teacher(),
      paper.id,
      {
        ...header,
        sections: [
          { title: "Section A — Objectives", questionIds: S.mcqIds },
          { title: "Section B — Theory", questionIds: [S.theoryId] },
        ],
      },
      meta,
    );
    expect(saved.totalMarks).toBe(13);
    expect(saved.sections.map((s) => s.marks)).toEqual([3, 10]);
    expect(saved.problems).toEqual([]);
  });

  it("a FINAL paper is frozen — by the service and by the database — and only it exports, version by version", async () => {
    const paper = await newPaper();
    await service.save(
      teacher(),
      paper.id,
      { ...header, sections: [{ title: "Section A — Objectives", questionIds: S.mcqIds }, { title: "Empty", questionIds: [] }] },
      meta,
    );
    await expect(service.finalise(teacher(), paper.id, meta)).rejects.toMatchObject({ code: "PAPER_NOT_READY" });
    await expect(service.exportData(teacher(), paper.id, { version: "A" }, meta)).rejects.toMatchObject({ code: "PAPER_NOT_FINAL" });

    await service.save(teacher(), paper.id, { ...header, sections: [{ title: "Section A — Objectives", questionIds: S.mcqIds }] }, meta);
    const final = await service.finalise(teacher(), paper.id, meta);
    expect(final).toMatchObject({ status: "FINAL", finalisedByName: "Tunde Teacher", totalMarks: 3 });

    // The service refuses…
    await expect(
      service.save(teacher(), paper.id, { ...header, sections: [{ title: "x", questionIds: [] }] }, meta),
    ).rejects.toMatchObject({ code: "PAPER_FINAL" });
    await expect(service.remove(teacher(), paper.id, meta)).rejects.toMatchObject({ code: "PAPER_FINAL" });
    // …and so does the database, however the write arrives.
    await expect(
      withTenant(S.schoolId, (db) => db.examPaper.update({ where: { id: paper.id }, data: { title: "Changed" } })),
    ).rejects.toThrow(/FINAL and cannot be changed/);
    await expect(
      withTenant(S.schoolId, (db) => db.examPaperItem.deleteMany({ where: { paperId: paper.id } })),
    ).rejects.toThrow(/FINAL and cannot be changed/);
    await expect(
      withTenant(S.schoolId, (db) => db.examPaperSection.update({ where: { id: final.sections[0]!.id }, data: { title: "x" } })),
    ).rejects.toThrow(/FINAL and cannot be changed/);

    // Version A prints as set; B moves the options, and its key follows the answer.
    const a = await service.exportData(teacher(), paper.id, { version: "A" }, meta);
    const b = await service.exportData(teacher(), paper.id, { version: "B" }, meta);
    expect(a.totalMarks).toBe(3);
    expect(a.sections[0]!.questions.map((q) => q.number)).toEqual([1, 2, 3]);
    for (const [i, qa] of a.sections[0]!.questions.entries()) {
      expect(qa.correctLetter).toBe("B"); // Velocity, as set
      const qb = b.sections[0]!.questions[i]!;
      const correctText = qa.options.find((o) => o.letter === qa.correctLetter)!.text;
      expect(qb.options.find((o) => o.letter === qb.correctLetter)!.text).toBe(correctText);
      expect(qb.options.map((o) => o.text)).not.toEqual(qa.options.map((o) => o.text));
    }
    // Reprinting gives the same version B.
    expect(await service.exportData(teacher(), paper.id, { version: "B" }, meta)).toEqual(b);
    // Only the versions it was set with.
    await expect(service.exportData(teacher(), paper.id, { version: "D" }, meta)).rejects.toBeInstanceOf(ValidationError);

    const exports = await withTenant(S.schoolId, (db) =>
      db.auditLog.findMany({ where: { entityId: paper.id, action: "exam-paper.export" }, select: { metadata: true, userId: true } }),
    );
    expect(exports.map((e) => (e.metadata as { version: string }).version).sort()).toEqual(["A", "B", "B"]);
    expect(exports.every((e) => e.userId === S.teacherId)).toBe(true);
  });

  it("duplicating a FINAL paper makes an editable copy; a question retired since shows as a problem", async () => {
    const paper = await newPaper(owner());
    await service.save(owner(), paper.id, { ...header, sections: [{ title: "Theory", questionIds: [S.theoryId] }] }, meta);
    await service.finalise(owner(), paper.id, meta);

    await bank.retire(owner(), S.theoryId, meta);
    const copy = await service.duplicate(owner(), paper.id, meta);
    expect(copy).toMatchObject({ status: "DRAFT", duplicatedFromId: paper.id, totalMarks: 10 });
    expect(copy.problems.join(" ")).toMatch(/retired since/);
    await expect(service.finalise(owner(), copy.id, meta)).rejects.toMatchObject({ code: "PAPER_NOT_READY" });
    // The FINAL original still exports the retired question's wording unchanged.
    const printed = await service.exportData(owner(), paper.id, { version: "A" }, meta);
    expect(printed.sections[0]!.questions[0]!.text).toBe("Derive v = u + at.");
    // A draft is deleted outright.
    await service.remove(owner(), copy.id, meta);
    await expect(service.get(owner(), copy.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("draw picks only approved, unused questions of the type asked for", async () => {
    const drawn = await service.draw(teacher(), {
      subjectId: S.physicsId,
      classLevelId: S.levelId,
      type: "MULTIPLE_CHOICE",
      count: 10,
      excludeIds: [S.mcqIds[0]!],
    });
    expect(drawn.map((q) => q.id).sort()).toEqual([S.mcqIds[1]!, S.mcqIds[2]!].sort());
    expect(drawn.every((q) => q.status === "APPROVED")).toBe(true);
    await expect(
      service.draw(outsider(), { subjectId: S.physicsId, classLevelId: S.levelId, type: "THEORY", count: 1, excludeIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a FINAL paper set for the Exam column gives that column its 'Out of'", async () => {
    expect(S.examComponentId).not.toBe(""); // signup seeds CA1/CA2/Exam
    const paper = await newPaper();
    await service.save(
      teacher(),
      paper.id,
      { ...header, componentId: S.examComponentId, sections: [{ title: "A", questionIds: S.mcqIds }] },
      meta,
    );
    const before = await service.outOf(teacher(), { termId: S.termId, classArmId: S.armId, subjectId: S.physicsId });
    expect(before.papers.find((p) => p.paperId === paper.id)).toBeUndefined(); // drafts don't count
    await service.finalise(teacher(), paper.id, meta);
    const after = await service.outOf(teacher(), { termId: S.termId, classArmId: S.armId, subjectId: S.physicsId });
    expect(after.papers).toEqual([{ componentId: S.examComponentId, paperId: paper.id, title: "Physics exam", totalMarks: 3 }]);
    expect(await service.outOf(outsider(), { termId: S.termId, classArmId: S.armId, subjectId: S.physicsId })).toEqual({ papers: [] });
  });
});
