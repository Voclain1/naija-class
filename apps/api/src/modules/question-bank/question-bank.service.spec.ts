import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AiCallRequest, AiCallResult, AnthropicPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, InternalError, NotFoundError, UnauthorizedError } from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { EmbeddingService } from "../../common/embeddings/embedding.service.js";
import { AuthService } from "../auth/auth.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { QuestionBankService, parseDrafts } from "./question-bank.service.js";

// Phase 8c / CP5b — the question bank, against real Postgres with the model
// faked. What carries the risk, and gets the tests:
//   * D62 — a teacher works only on the subjects they teach at a level, and
//     the subject teacher or an admin is who approves;
//   * an approved question is never edited in place, so a paper keeps the
//     wording it was set with;
//   * AI output lands as DRAFT only, through the budget and the ledger, with
//     no student data in what is sent, and drafts that break the type rules
//     are dropped rather than saved.

const runId = Math.random().toString(36).slice(2, 8);
const meta = { ipAddress: "127.0.0.1" };
const ctx = (schoolId: string, userId: string) => ({ sessionId: `sess-${runId}`, schoolId, userId });

const mcq = (text: string, correct = 1) => ({
  topic: "Motion",
  type: "MULTIPLE_CHOICE" as const,
  difficulty: "MEDIUM" as const,
  text,
  marks: 1,
  answerGuide: null,
  options: ["Speed", "Velocity", "Mass", "Weight"].map((t, i) => ({ text: t, isCorrect: i === correct })),
});

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  reply = "";
  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    return { text: this.reply, inputTokens: 300, outputTokens: 900, stopReason: "end_turn" };
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;

describe("QuestionBankService (integration)", () => {
  let port: FakePort;
  let service: QuestionBankService;
  let S: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    outsiderId: string;
    levelId: string;
    otherLevelId: string;
    physicsId: string;
    chemistryId: string;
  };

  beforeEach(() => {
    port = new FakePort();
    service = new QuestionBankService(
      new AiGenerationService(configStub(), port),
      new CurriculumRetrievalService(new EmbeddingService(configStub())),
    );
  });

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Bank ${runId}`,
        schoolSlug: `bank-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `bank-${runId}@example.test`,
        ownerPhone: `+23498${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    await basePrisma.school.update({
      where: { id: schoolId },
      data: { status: "ACTIVE", onboardingStep: 5, aiEnabled: true, aiMonthlyTokenBudget: 5_000_000 },
    });

    S = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") },
      });
      const [level, otherLevel] = await db.classLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: "asc" }, take: 2 });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level!.id, name: "Gold", code: `qb-${runId}` },
      });
      const physics = await db.subject.create({ data: { schoolId, name: `Physics ${runId}`, code: `PHY-${runId}` } });
      const chemistry = await db.subject.create({ data: { schoolId, name: `Chemistry ${runId}`, code: `CHE-${runId}` } });
      const teacherRole = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });
      const makeTeacher = async (email: string, firstName: string) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Teacher" } });
        await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        return user.id;
      };
      const teacherId = await makeTeacher(`qb-t-${runId}@example.test`, "Tunde");
      const outsiderId = await makeTeacher(`qb-o-${runId}@example.test`, "Ngozi");
      // Tunde teaches Physics in this level's Gold arm, and nothing else.
      await db.teacherAssignment.create({
        data: { schoolId, teacherId, classArmId: arm.id, subjectId: physics.id, academicYearId: year.id, isActive: true },
      });
      return {
        schoolId,
        ownerId: signed.user.id,
        teacherId,
        outsiderId,
        levelId: level!.id,
        otherLevelId: otherLevel!.id,
        physicsId: physics.id,
        chemistryId: chemistry.id,
      };
    });
  });

  afterAll(async () => {
    if (!S) return;
    await withTenant(S.schoolId, async (db) => {
      await db.question.deleteMany({ where: { schoolId: S.schoolId, supersedesId: { not: null } } });
      await db.question.deleteMany({ where: { schoolId: S.schoolId } });
      await db.aIGeneration.deleteMany({ where: { schoolId: S.schoolId } });
      await db.aIBudgetPeriod.deleteMany({ where: { schoolId: S.schoolId } });
    });
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
  });

  const teacher = () => ctx(S.schoolId, S.teacherId);
  const owner = () => ctx(S.schoolId, S.ownerId);
  const outsider = () => ctx(S.schoolId, S.outsiderId);
  const physicsAt = (levelId = S.levelId) => ({ subjectId: S.physicsId, classLevelId: levelId });

  // ---- D62: scope ----------------------------------------------------------

  it("a teacher writes, reads and approves only for a subject they teach at that level", async () => {
    const q = await service.create(teacher(), { ...physicsAt(), ...mcq("Which is a vector?") }, meta);
    expect(q).toMatchObject({ status: "DRAFT", source: "MANUAL", createdByName: "Tunde Teacher" });
    expect(q.options.map((o) => o.isCorrect)).toEqual([false, true, false, false]);

    // Same subject, another level; another subject, same level.
    await expect(service.create(teacher(), { ...physicsAt(S.otherLevelId), ...mcq("x") }, meta)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      service.create(teacher(), { subjectId: S.chemistryId, classLevelId: S.levelId, ...mcq("x") }, meta),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // A teacher with no assignment sees nothing — not even that it exists.
    expect(await service.list(outsider(), {})).toEqual([]);
    await expect(service.get(outsider(), q.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.approve(outsider(), q.id, meta)).rejects.toBeInstanceOf(NotFoundError);
    expect((await service.getScope(outsider())).pairs).toEqual([]);

    // The subject teacher approves (D62).
    const approved = await service.approve(teacher(), q.id, meta);
    expect(approved).toMatchObject({ status: "APPROVED", approvedBy: S.teacherId, approvedByName: "Tunde Teacher" });

    const scope = await service.getScope(teacher());
    expect(scope).toMatchObject({ all: false, pairs: [{ classLevelId: S.levelId, subjectId: S.physicsId }] });
    const ownerScope = await service.getScope(owner());
    expect(ownerScope.all).toBe(true);
    // Every active level and subject — not only matrix-linked ones, which a
    // fresh school has none of.
    expect(ownerScope.levels.map((l) => l.id)).toEqual(expect.arrayContaining([S.levelId, S.otherLevelId]));
    expect(ownerScope.subjects.map((s) => s.id)).toEqual(expect.arrayContaining([S.physicsId, S.chemistryId]));
  });

  it("an admin works on any subject and level; the list filters and searches", async () => {
    const chem = await service.create(
      owner(),
      { subjectId: S.chemistryId, classLevelId: S.otherLevelId, ...mcq(`Atoms ${runId}`), topic: "Atomic structure" },
      meta,
    );
    const all = await service.list(owner(), { subjectId: S.chemistryId });
    expect(all.map((q) => q.id)).toContain(chem.id);
    expect((await service.list(owner(), { q: "atomic STRUCTURE" })).map((q) => q.id)).toEqual([chem.id]);
    // Never in the teacher's list: not their subject.
    expect((await service.list(teacher(), {})).map((q) => q.id)).not.toContain(chem.id);
  });

  // ---- an approved question is never edited in place -----------------------

  it("editing an approved question makes a draft revision; approving it retires the original, whose wording is unchanged", async () => {
    const original = await service.approve(
      teacher(),
      (await service.create(teacher(), { ...physicsAt(), ...mcq("Original wording") }, meta)).id,
      meta,
    );

    const revision = await service.update(teacher(), original.id, mcq("Better wording"), meta);
    expect(revision.id).not.toBe(original.id);
    expect(revision).toMatchObject({ status: "DRAFT", supersedesId: original.id, text: "Better wording" });
    const stillOriginal = await service.get(teacher(), original.id);
    expect(stillOriginal).toMatchObject({ status: "APPROVED", text: "Original wording", openRevisionId: revision.id });

    // One open revision at a time.
    await expect(service.update(owner(), original.id, mcq("Third"), meta)).rejects.toMatchObject({ code: "REVISION_OPEN" });

    // The draft revision IS edited in place.
    const edited = await service.update(teacher(), revision.id, mcq("Best wording", 2), meta);
    expect(edited.id).toBe(revision.id);
    expect(edited.options.find((o) => o.isCorrect)?.text).toBe("Mass");

    await service.approve(owner(), revision.id, meta);
    const retired = await service.get(teacher(), original.id);
    expect(retired).toMatchObject({ status: "RETIRED", text: "Original wording" });
    expect(retired.retiredAt).not.toBeNull();
    // Retired is final, and kept out of the default list.
    await expect(service.update(teacher(), original.id, mcq("x"), meta)).rejects.toMatchObject({ code: "QUESTION_RETIRED" });
    expect((await service.list(teacher(), {})).map((q) => q.id)).not.toContain(original.id);
    expect((await service.list(teacher(), { status: "RETIRED" })).map((q) => q.id)).toContain(original.id);

    const actions = await withTenant(S.schoolId, (db) =>
      db.auditLog.findMany({
        where: { entityType: "question", entityId: { in: [original.id, revision.id] } },
        select: { action: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(actions.map((a) => a.action)).toEqual([
      "question.create",
      "question.approve",
      "question.revise",
      "question.update",
      "question.approve",
    ]);
  });

  it("drafts are discarded, approved questions retired — never the other way round", async () => {
    const draft = await service.create(teacher(), { ...physicsAt(), ...mcq("Discard me") }, meta);
    await expect(service.retire(teacher(), draft.id, meta)).rejects.toMatchObject({ code: "NOT_APPROVED" });
    await service.discard(teacher(), draft.id, meta);
    await expect(service.get(teacher(), draft.id)).rejects.toBeInstanceOf(NotFoundError);

    const approved = await service.approve(teacher(), (await service.create(teacher(), { ...physicsAt(), ...mcq("Keep me") }, meta)).id, meta);
    await expect(service.discard(teacher(), approved.id, meta)).rejects.toMatchObject({ code: "NOT_A_DRAFT" });
    await expect(service.approve(teacher(), approved.id, meta)).rejects.toMatchObject({ code: "NOT_A_DRAFT" });
    expect((await service.retire(teacher(), approved.id, meta)).status).toBe("RETIRED");
  });

  it("the database refuses an approval with no approver, and a second correct option", async () => {
    const draft = await service.create(teacher(), { ...physicsAt(), ...mcq("Constraint check") }, meta);
    await expect(
      withTenant(S.schoolId, (db) => db.question.update({ where: { id: draft.id }, data: { status: "APPROVED" } })),
    ).rejects.toThrow(/questions_approval_check/);
    await expect(
      withTenant(S.schoolId, (db) =>
        db.questionOption.updateMany({ where: { questionId: draft.id }, data: { isCorrect: true } }),
      ),
    ).rejects.toThrow(/question_options_one_correct_idx|Unique constraint/);
  });

  it("an inactive teacher cannot write", async () => {
    await withTenant(S.schoolId, (db) => db.user.update({ where: { id: S.teacherId }, data: { isActive: false } }));
    try {
      await expect(service.create(teacher(), { ...physicsAt(), ...mcq("x") }, meta)).rejects.toBeInstanceOf(UnauthorizedError);
    } finally {
      await withTenant(S.schoolId, (db) => db.user.update({ where: { id: S.teacherId }, data: { isActive: true } }));
    }
  });

  // ---- AI drafting -----------------------------------------------------------

  it("AI drafts are saved as DRAFTs, ledgered, and a draft that breaks the rules is dropped", async () => {
    port.reply = JSON.stringify({
      questions: [
        { text: "A car moves 100 m in 20 s. What is its speed?", marks: 1, answerGuide: "5 m/s", options: [
          { text: "2 m/s", isCorrect: false }, { text: "5 m/s", isCorrect: true }, { text: "20 m/s", isCorrect: false }, { text: "120 m/s", isCorrect: false },
        ] },
        // Two keys: dropped, not saved.
        { text: "Which is a scalar?", marks: 1, answerGuide: "", options: [
          { text: "Speed", isCorrect: true }, { text: "Mass", isCorrect: true }, { text: "Force", isCorrect: false }, { text: "Velocity", isCorrect: false },
        ] },
        { text: "Which quantity has direction?", marks: 1, answerGuide: "", options: [
          { text: "Distance", isCorrect: false }, { text: "Displacement", isCorrect: true }, { text: "Time", isCorrect: false }, { text: "Mass", isCorrect: false },
        ] },
      ],
      groundedInScheme: false,
    });

    const result = await service.generate(
      teacher(),
      { ...physicsAt(), topic: `Motion ${runId}`, type: "MULTIPLE_CHOICE", difficulty: "EASY", count: 3 },
      meta,
    );
    expect(result).toMatchObject({ requested: 3, dropped: 1, grounding: { usedScheme: false } });
    expect(result.questions).toHaveLength(2);
    expect(result.questions.every((q) => q.status === "DRAFT" && q.source === "AI" && q.approvedBy === null)).toBe(true);
    expect(result.questions[0]!.options.find((o) => o.isCorrect)?.text).toBe("5 m/s");

    // One call, through the ledger, with the prompt's name and version.
    expect(port.calls).toHaveLength(1);
    const ledger = await withTenant(S.schoolId, (db) =>
      db.aIGeneration.findMany({ where: { schoolId: S.schoolId, promptName: "exam-questions" } }),
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.promptVersion).toBe("1");
    // What was sent names a level, a subject and a topic — and no person.
    const sent = port.calls[0]!.userContent;
    expect(sent).toContain(`Motion ${runId}`);
    expect(sent).not.toMatch(/Tunde|Owen|Teacher|Owner/);

    // The drafts still need a person: approving one is a separate act.
    const approved = await service.approve(teacher(), result.questions[0]!.id, meta);
    expect(approved.status).toBe("APPROVED");
  });

  it("drafting outside the teacher's subjects never reaches the model; a school with AI off is refused with nothing saved", async () => {
    port.reply = JSON.stringify({ questions: [], groundedInScheme: false });
    await expect(
      service.generate(outsider(), { ...physicsAt(), topic: "x", type: "THEORY", difficulty: "HARD", count: 1 }, meta),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(port.calls).toHaveLength(0);

    await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiEnabled: false } });
    try {
      const before = await withTenant(S.schoolId, (db) => db.question.count());
      await expect(
        service.generate(teacher(), { ...physicsAt(), topic: "x", type: "THEORY", difficulty: "HARD", count: 1 }, meta),
      ).rejects.toMatchObject({ code: "AI_DISABLED_SCHOOL" });
      expect(port.calls).toHaveLength(0);
      expect(await withTenant(S.schoolId, (db) => db.question.count())).toBe(before);
    } finally {
      await basePrisma.school.update({ where: { id: S.schoolId }, data: { aiEnabled: true } });
    }
  });

  it("a response with no usable draft is an error, not an empty success", async () => {
    port.reply = JSON.stringify({
      questions: [{ text: "Explain inertia.", marks: 5, answerGuide: "", options: [] }], // theory with no marking guide
      groundedInScheme: false,
    });
    await expect(
      service.generate(teacher(), { ...physicsAt(), topic: "Inertia", type: "THEORY", difficulty: "MEDIUM", count: 1 }, meta),
    ).rejects.toBeInstanceOf(InternalError);
  });
});

describe("parseDrafts", () => {
  it("keeps drafts that pass the type rules and counts the rest", () => {
    const raw = JSON.stringify({
      questions: [
        { text: "Define work.", marks: 2, answerGuide: "Force × distance moved in its direction.", options: [{ text: "x", isCorrect: true }] },
        { text: "Define power.", marks: 0, answerGuide: "Rate of doing work.", options: [] }, // 0 marks
        { text: "  ", marks: 2, answerGuide: "x", options: [] }, // blank
        { text: "Define energy.", marks: 2.5, answerGuide: "x", options: [] }, // not whole
      ],
      groundedInScheme: true,
    });
    const parsed = parseDrafts(raw, "SHORT_ANSWER")!;
    expect(parsed.total).toBe(4);
    expect(parsed.groundedInScheme).toBe(true);
    // Options the model put on a short-answer question are ignored, not fatal.
    expect(parsed.valid).toEqual([
      { text: "Define work.", marks: 2, answerGuide: "Force × distance moved in its direction.", options: [] },
    ]);
  });

  it("returns null for output that is not the expected JSON", () => {
    expect(parseDrafts("Here are your questions!", "THEORY")).toBeNull();
    expect(parseDrafts(JSON.stringify({ items: [] }), "THEORY")).toBeNull();
  });
});
