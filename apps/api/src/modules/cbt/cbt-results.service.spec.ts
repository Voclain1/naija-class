import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { NotFoundError, ValidationError } from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { EmbeddingService } from "../../common/embeddings/embedding.service.js";
import { AuthService } from "../auth/auth.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { ExamPapersService } from "../exam-papers/exam-papers.service.js";
import { QuestionBankService } from "../question-bank/question-bank.service.js";
import { CbtResultsService } from "./cbt-results.service.js";
import { CbtSittingsService } from "./cbt-sittings.service.js";

// Online exams (CBT3) results, against real Postgres (docs/modules/cbt.md):
//   * the objective score is marked on the server against the frozen key;
//   * the theory mark is capped at the paper's on-paper total, for students
//     on the register only;
//   * two computers need the teacher's choice before a total exists, and the
//     choice can move (one chosen per student, held by the database);
//   * a total exists only when it can honestly be sent to the gradebook.

const runId = Math.random().toString(36).slice(2, 8);
const meta = { ipAddress: "127.0.0.1" };
const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const hour = 3_600_000;
const DEVICE = (n: number) => `${String(n).repeat(8)}-0000-4000-8000-000000000000`;

describe("CbtResultsService (integration)", () => {
  const bank = new QuestionBankService(
    new AiGenerationService(configStub(), { create: async () => ({ text: "", inputTokens: 0, outputTokens: 0, stopReason: "end_turn" }) }),
    new CurriculumRetrievalService(new EmbeddingService(configStub())),
  );
  const papers = new ExamPapersService(bank);
  const sittings = new CbtSittingsService(bank);
  const results = new CbtResultsService(sittings);
  let S: { schoolId: string; owner: { sessionId: string; schoolId: string; userId: string }; paperId: string; armId: string; outsiderId: string };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `CBT results ${runId}`,
        schoolSlug: `cbtr-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cbtr-${runId}@example.test`,
        ownerPhone: `+23498${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    const owner = { sessionId: `sess-${runId}`, schoolId, userId: signed.user.id };

    const base = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2026-09-01"), endDate: new Date("2026-12-11") },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "Gold", code: `cbtr-${runId}` } });
      const subject = await db.subject.create({ data: { schoolId, name: `Biology ${runId}`, code: `BIO-${runId}` } });
      for (const [i, [firstName, lastName]] of [["Ada", "Okafor"], ["Bayo", "Adeyemi"]].entries()) {
        const student = await db.student.create({
          data: { schoolId, admissionNumber: `CBTR/${runId}/${i}`, firstName: firstName!, lastName: lastName!, dateOfBirth: new Date("2012-01-01"), gender: "FEMALE" },
        });
        await db.enrollment.create({ data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
      }
      const outsider = await db.student.create({
        data: { schoolId, admissionNumber: `CBTR/${runId}/x`, firstName: "Uche", lastName: "Outside", dateOfBirth: new Date("2012-01-01"), gender: "MALE" },
      });
      return { term, level, arm, subject, outsiderId: outsider.id };
    });

    const at = { subjectId: base.subject.id, classLevelId: base.level.id };
    const approved = async (input: Parameters<QuestionBankService["create"]>[1]) =>
      (await bank.approve(owner, (await bank.create(owner, input, meta)).id, meta)).id;
    const mcq = (text: string, marks: number) =>
      approved({ ...at, topic: "Cells", type: "MULTIPLE_CHOICE", difficulty: "EASY", text, marks, answerGuide: null, options: ["Right", "Wrong", "Also wrong"].map((t, i) => ({ text: `${t} (${text})`, isCorrect: i === 0 })) });
    const questionIds = [await mcq("Q1", 2), await mcq("Q2", 3)];
    const theory = await approved({ ...at, topic: "Cells", type: "THEORY", difficulty: "HARD", text: "Draw a cell.", marks: 10, answerGuide: "Label it.", options: [] });
    const paper = await papers.create(owner, { ...at, termId: base.term.id, title: "Biology CBT", durationMinutes: 40, versionCount: 2 }, meta);
    await papers.save(owner, paper.id, {
      title: "Biology CBT", durationMinutes: 40, instructions: null, componentId: null, versionCount: 2,
      sections: [{ title: "A", questionIds }, { title: "B", questionIds: [theory] }],
    }, meta);
    await papers.finalise(owner, paper.id, meta);
    S = { schoolId, owner, paperId: paper.id, armId: base.arm.id, outsiderId: base.outsiderId };
  }, 60_000);

  afterAll(async () => {
    if (!S) return;
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { deletionStartedAt: new Date() } }).catch(() => undefined);
    await withTenant(S.schoolId, (db) => db.cbtAttempt.deleteMany({})).catch(() => undefined);
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
  });

  async function published() {
    const start = Date.now() + 24 * hour;
    const draft = await sittings.create(
      S.owner,
      { paperId: S.paperId, title: "Biology online", classArmIds: [S.armId], startsAt: new Date(start).toISOString(), windowEndsAt: new Date(start + hour).toISOString(), durationMinutes: 40 },
      meta,
    );
    await sittings.publish(S.owner, draft.id, meta);
    return draft.id;
  }

  /** The paper's MCQ items in order, each with its correct and a wrong option. */
  async function key() {
    return withTenant(S.schoolId, async (db) =>
      (
        await db.examPaperItem.findMany({
          where: { paperId: S.paperId, question: { type: "MULTIPLE_CHOICE" } },
          orderBy: { orderIndex: "asc" },
          include: { question: { include: { options: { orderBy: { orderIndex: "asc" } } } } },
        })
      ).map((i) => ({ itemId: i.id, right: i.question.options.find((o) => o.isCorrect)!.id, wrong: i.question.options.find((o) => !o.isCorrect)!.id })),
    );
  }

  async function addAttempt(sittingId: string, studentId: string, device: number, answers: Record<string, string>, submitted = true) {
    return withTenant(S.schoolId, async (db) => {
      const candidate = await db.cbtCandidate.findFirstOrThrow({ where: { sittingId, studentId } });
      const startedAt = new Date(Date.now() - 30 * 60_000);
      return db.cbtAttempt.create({
        data: {
          schoolId: S.schoolId, sittingId, candidateId: candidate.id, deviceId: DEVICE(device), seq: 5, answers,
          answeredCount: Object.keys(answers).length, startedAt, submittedAt: submitted ? new Date() : null,
        },
      });
    });
  }

  const students = async (sittingId: string) =>
    withTenant(S.schoolId, (db) => db.cbtCandidate.findMany({ where: { sittingId }, include: { student: true }, orderBy: { student: { lastName: "asc" } } }));

  it("no results while draft", async () => {
    const start = Date.now() + 24 * hour;
    const draft = await sittings.create(
      S.owner,
      { paperId: S.paperId, title: "Draft", classArmIds: [S.armId], startsAt: new Date(start).toISOString(), windowEndsAt: new Date(start + hour).toISOString(), durationMinutes: 40 },
      meta,
    );
    await expect(results.results(S.owner, draft.id)).rejects.toMatchObject({ code: "SITTING_NOT_PUBLISHED" });
  });

  it("marks against the frozen key, and the total waits for the theory mark", async () => {
    const id = await published();
    const [q1, q2] = await key();
    const [bayo, ada] = await students(id); // Adeyemi, Okafor
    await addAttempt(id, ada!.studentId, 1, { [q1!.itemId]: q1!.right, [q2!.itemId]: q2!.wrong });

    let r = await results.results(S.owner, id);
    expect(r).toMatchObject({ questionCount: 2, objectiveTotal: 5, onPaperTotal: 10, paperTotal: 15, termId: expect.any(String), componentId: null });
    const adaRow = () => r.rows.find((x) => x.studentId === ada!.studentId)!;
    expect(adaRow()).toMatchObject({ objectiveScore: 2, theoryMark: null, total: null, needsChoice: false });
    expect(adaRow().attempts[0]).toMatchObject({ computerLabel: "Computer 1", answeredCount: 2, objectiveScore: 2, flags: [] });
    expect(r.rows.find((x) => x.studentId === bayo!.studentId)).toMatchObject({ attempts: [], objectiveScore: null, total: null });
    // The DTO carries scores, never the key.
    expect(JSON.stringify(r)).not.toContain(q1!.right);

    r = await results.saveTheoryMarks(S.owner, id, { marks: [{ studentId: ada!.studentId, theoryMark: 7 }] }, meta);
    expect(adaRow()).toMatchObject({ theoryMark: 7, total: 9 });

    await expect(results.saveTheoryMarks(S.owner, id, { marks: [{ studentId: ada!.studentId, theoryMark: 11 }] }, meta)).rejects.toBeInstanceOf(ValidationError);
    await expect(results.saveTheoryMarks(S.owner, id, { marks: [{ studentId: S.outsiderId, theoryMark: 3 }] }, meta)).rejects.toBeInstanceOf(ValidationError);
    // A refused batch writes nothing, even for its valid rows.
    await expect(
      results.saveTheoryMarks(S.owner, id, { marks: [{ studentId: ada!.studentId, theoryMark: 1 }, { studentId: ada!.studentId, theoryMark: 99 }] }, meta),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(adaRow().theoryMark).toBe(7);
    r = await results.results(S.owner, id);
    expect(adaRow().theoryMark).toBe(7);

    const audited = await withTenant(S.schoolId, (db) => db.auditLog.count({ where: { entityId: id, action: "cbt-result.theory-marks" } }));
    expect(audited).toBe(1);
  });

  it("two computers need the teacher's choice; the choice can move, one at a time", async () => {
    const id = await published();
    const [q1, q2] = await key();
    const [, ada] = await students(id);
    const first = await addAttempt(id, ada!.studentId, 1, { [q1!.itemId]: q1!.right }, false);
    const second = await addAttempt(id, ada!.studentId, 2, { [q1!.itemId]: q1!.right, [q2!.itemId]: q2!.right });
    await results.saveTheoryMarks(S.owner, id, { marks: [{ studentId: ada!.studentId, theoryMark: 4 }] }, meta);

    let r = await results.results(S.owner, id);
    let row = r.rows.find((x) => x.studentId === ada!.studentId)!;
    expect(row).toMatchObject({ needsChoice: true, countingAttemptId: null, objectiveScore: null, total: null });
    expect(row.attempts.map((a) => [a.computerLabel, a.objectiveScore])).toEqual([["Computer 1", 2], ["Computer 2", 5]]);
    expect(row.attempts[0]!.flags).toContain("NOT_SUBMITTED");

    r = await results.chooseAttempt(S.owner, id, second.id, meta);
    row = r.rows.find((x) => x.studentId === ada!.studentId)!;
    expect(row).toMatchObject({ needsChoice: false, countingAttemptId: second.id, objectiveScore: 5, total: 9 });

    r = await results.chooseAttempt(S.owner, id, first.id, meta);
    row = r.rows.find((x) => x.studentId === ada!.studentId)!;
    expect(row).toMatchObject({ countingAttemptId: first.id, objectiveScore: 2, total: 6 });
    expect(row.attempts.filter((a) => a.chosen)).toHaveLength(1);

    // An attempt from another exam is not this exam's to choose.
    const other = await published();
    await expect(results.chooseAttempt(S.owner, other, first.id, meta)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the database holds one chosen attempt per student", async () => {
    const id = await published();
    const [, ada] = await students(id);
    const a = await addAttempt(id, ada!.studentId, 1, {});
    const b = await addAttempt(id, ada!.studentId, 2, {});
    await withTenant(S.schoolId, (db) => db.cbtAttempt.update({ where: { id: a.id }, data: { chosen: true } }));
    await expect(withTenant(S.schoolId, (db) => db.cbtAttempt.update({ where: { id: b.id }, data: { chosen: true } }))).rejects.toThrow();
  });
});
