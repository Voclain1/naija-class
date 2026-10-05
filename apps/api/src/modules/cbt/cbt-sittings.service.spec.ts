import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  formatUnlockCode,
  normaliseCbtCode,
  optionOrderFor,
  versionForCandidate,
  type CbtPackEnvelope,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { EmbeddingService } from "../../common/embeddings/embedding.service.js";
import { AuthService } from "../auth/auth.service.js";
import { CurriculumRetrievalService } from "../curriculum/curriculum-retrieval.service.js";
import { ExamPapersService } from "../exam-papers/exam-papers.service.js";
import { QuestionBankService } from "../question-bank/question-bank.service.js";
import { openPack } from "./cbt-pack-crypto.js";
import { CbtSittingsService } from "./cbt-sittings.service.js";

// Online exams (CBT1), against real Postgres. The risks (docs/modules/cbt.md):
//   * only a FINAL paper with deliverable questions can be scheduled (D1);
//   * publishing freezes the candidates and their versions (D2);
//   * the pack opens ONLY with the unlock code, holds each version's options
//     in that version's order, and never carries the answer key (D3, D4);
//   * the codes are shown only once published, and every view is audited;
//   * D62 scope, as for exam papers.

const runId = Math.random().toString(36).slice(2, 8);
const meta = { ipAddress: "127.0.0.1" };
const ctx = (schoolId: string, userId: string) => ({ sessionId: `sess-${runId}`, schoolId, userId });
const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const hour = 3_600_000;

describe("versionForCandidate", () => {
  it("is deterministic and spreads students across the paper's versions", () => {
    expect(versionForCandidate("s", "student-1", 3)).toBe(versionForCandidate("s", "student-1", 3));
    expect(versionForCandidate("s", "student-1", 1)).toBe("A");
    const seen = new Set(Array.from({ length: 40 }, (_, i) => versionForCandidate("s", `student-${i}`, 4)));
    expect(seen).toEqual(new Set(["A", "B", "C", "D"]));
  });

  it("formats and normalises codes the way people type them", () => {
    expect(formatUnlockCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
    expect(normaliseCbtCode(" abcd-efgh jkmn ")).toBe("ABCDEFGHJKMN");
  });
});

describe("CbtSittingsService (integration)", () => {
  const bank = new QuestionBankService(
    new AiGenerationService(configStub(), { create: async () => ({ text: "", inputTokens: 0, outputTokens: 0, stopReason: "end_turn" }) }),
    new CurriculumRetrievalService(new EmbeddingService(configStub())),
  );
  const papers = new ExamPapersService(bank);
  const service = new CbtSittingsService(bank);
  let S: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    outsiderId: string;
    armId: string;
    otherLevelArmId: string;
    paperId: string;
    draftPaperId: string;
    theoryOnlyPaperId: string;
    studentIds: string[];
  };

  beforeAll(async () => {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `CBT ${runId}`,
        schoolSlug: `cbt-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cbt-${runId}@example.test`,
        ownerPhone: `+23496${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
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
      const [level, otherLevel] = await db.classLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: "asc" }, take: 2 });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level!.id, name: "Gold", code: `cbt-${runId}` } });
      const otherArm = await db.classArm.create({ data: { schoolId, classLevelId: otherLevel!.id, name: "Blue", code: `cbt-o-${runId}` } });
      const physics = await db.subject.create({ data: { schoolId, name: `Physics ${runId}`, code: `PHY-${runId}` } });
      const teacherRole = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });
      const makeTeacher = async (email: string, firstName: string) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Teacher" } });
        await db.userRole.create({ data: { userId: user.id, roleId: teacherRole.id } });
        return user.id;
      };
      const teacherId = await makeTeacher(`cbt-t-${runId}@example.test`, "Tunde");
      const outsiderId = await makeTeacher(`cbt-o-${runId}@example.test`, "Ngozi");
      await db.teacherAssignment.create({
        data: { schoolId, teacherId, classArmId: arm.id, subjectId: physics.id, academicYearId: year.id, isActive: true },
      });
      const studentIds: string[] = [];
      for (const [i, name] of ["Ada Okafor", "Bayo Adeyemi", "Chika Eze"].entries()) {
        const [firstName, lastName] = name.split(" ");
        const student = await db.student.create({
          data: { schoolId, admissionNumber: `CBT/${runId}/${i}`, firstName: firstName!, lastName: lastName!, dateOfBirth: new Date("2012-01-01"), gender: "FEMALE" },
        });
        await db.enrollment.create({ data: { schoolId, studentId: student.id, termId: term.id, academicYearId: year.id, classArmId: arm.id } });
        studentIds.push(student.id);
      }
      return { term, level: level!, arm, otherArm, physics, teacherId, outsiderId, studentIds };
    });

    const at = { subjectId: base.physics.id, classLevelId: base.level.id };
    const approved = async (input: Parameters<QuestionBankService["create"]>[1]) =>
      (await bank.approve(owner, (await bank.create(owner, input, meta)).id, meta)).id;
    const mcq = (text: string) =>
      approved({
        ...at,
        topic: "Motion",
        type: "MULTIPLE_CHOICE",
        difficulty: "MEDIUM",
        text,
        marks: 2,
        answerGuide: null,
        options: ["Speed", "Velocity", "Mass", "Time"].map((t, i) => ({ text: `${t} (${text})`, isCorrect: i === 1 })),
      });
    const theory = await approved({ ...at, topic: "Motion", type: "THEORY", difficulty: "HARD", text: "Derive v = u + at.", marks: 10, answerGuide: "Rearrange.", options: [] });
    const mcqIds = [await mcq("Q1"), await mcq("Q2"), await mcq("Q3")];

    const makePaper = async (title: string, sections: { title: string; questionIds: string[] }[], finalise: boolean) => {
      const p = await papers.create(owner, { ...at, termId: base.term.id, title, durationMinutes: 60, versionCount: 2 }, meta);
      await papers.save(owner, p.id, { title, durationMinutes: 60, instructions: "Choose one option.", componentId: null, versionCount: 2, sections }, meta);
      if (finalise) await papers.finalise(owner, p.id, meta);
      return p.id;
    };
    const paperId = await makePaper("Physics CBT", [
      { title: "Section A — Objectives", questionIds: mcqIds },
      { title: "Section B — Theory", questionIds: [theory] },
    ], true);
    const draftPaperId = await makePaper("Physics draft", [{ title: "A", questionIds: mcqIds }], false);
    const theoryOnlyPaperId = await makePaper("Physics theory", [{ title: "B", questionIds: [theory] }], true);

    S = {
      schoolId,
      ownerId: signed.user.id,
      teacherId: base.teacherId,
      outsiderId: base.outsiderId,
      armId: base.arm.id,
      otherLevelArmId: base.otherArm.id,
      paperId,
      draftPaperId,
      theoryOnlyPaperId,
      studentIds: base.studentIds,
    };
  }, 60_000);

  afterAll(async () => {
    if (!S) return;
    await basePrisma.school.update({ where: { id: S.schoolId }, data: { deletionStartedAt: new Date() } }).catch(() => undefined);
    await basePrisma.school.delete({ where: { id: S.schoolId } }).catch(() => undefined);
  });

  const teacher = () => ctx(S.schoolId, S.teacherId);
  const outsider = () => ctx(S.schoolId, S.outsiderId);
  const times = (startInHours = 24) => {
    const start = Date.now() + startInHours * hour;
    return { startsAt: new Date(start).toISOString(), windowEndsAt: new Date(start + hour).toISOString(), durationMinutes: 40 };
  };
  const newSitting = (overrides: Record<string, unknown> = {}) =>
    service.create(teacher(), { paperId: S.paperId, title: "Physics online exam", classArmIds: [S.armId], ...times(), ...overrides }, meta);

  it("offers only FINAL papers with multiple-choice questions, in scope", async () => {
    const offered = await service.schedulablePapers(teacher());
    expect(offered.map((p) => p.id)).toEqual([S.paperId]);
    expect(offered[0]).toMatchObject({
      objectiveQuestionCount: 3,
      objectiveTotal: 6,
      onPaperQuestionCount: 1,
    });
    // Every active class at the paper's level (the school's default one too).
    expect(offered[0]!.arms).toContainEqual({ id: S.armId, name: "Gold" });
    expect(offered[0]!.arms.map((a) => a.id)).not.toContain(S.otherLevelArmId);
    expect(await service.schedulablePapers(outsider())).toEqual([]);
  });

  it("refuses a draft paper, a paper with nothing to sit online, another level's class and an empty window", async () => {
    await expect(newSitting({ paperId: S.draftPaperId })).rejects.toMatchObject({ code: "PAPER_NOT_FINAL" });
    await expect(newSitting({ paperId: S.theoryOnlyPaperId })).rejects.toMatchObject({ code: "PAPER_HAS_NO_OBJECTIVES" });
    await expect(newSitting({ classArmIds: [S.otherLevelArmId] })).rejects.toBeInstanceOf(ValidationError);
    const t = times();
    await expect(newSitting({ windowEndsAt: t.startsAt })).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.create(outsider(), { paperId: S.paperId, title: "x", classArmIds: [S.armId], ...times() }, meta),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a new sitting is a DRAFT with live candidates, and no codes are shown yet", async () => {
    const sitting = await newSitting();
    expect(sitting).toMatchObject({
      status: "DRAFT",
      candidateCount: 3,
      objectiveQuestionCount: 3,
      objectiveTotal: 6,
      onPaperQuestionCount: 1,
      onPaperTotal: 10,
      paperTotal: 16,
      versionCount: 2,
      armNames: ["Gold"],
    });
    await expect(service.invigilatorSheet(teacher(), sitting.id, meta)).rejects.toMatchObject({ code: "SITTING_NOT_PUBLISHED" });
    await expect(service.get(outsider(), sitting.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("publishing freezes candidates with their versions and builds a pack that opens only with the unlock code", async () => {
    const draft = await newSitting();
    const published = await service.publish(teacher(), draft.id, meta);
    expect(published).toMatchObject({ status: "PUBLISHED", candidateCount: 3 });
    expect(published.packBuiltAt).not.toBeNull();

    const candidates = await service.candidates(teacher(), draft.id);
    // Sorted by surname: Adeyemi, Eze, Okafor.
    expect(candidates.map((c) => c.firstName)).toEqual(["Bayo", "Chika", "Ada"]);
    for (const c of candidates) expect(c.version).toBe(versionForCandidate(draft.id, c.studentId, 2));

    const sheet = await service.invigilatorSheet(teacher(), draft.id, meta);
    expect(sheet.accessCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(sheet.unlockCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(sheet).toMatchObject({ schoolSlug: `cbt-${runId}`, candidateCount: 3, durationMinutes: 40 });

    const row = await withTenant(S.schoolId, (db) => db.cbtSitting.findUniqueOrThrow({ where: { id: draft.id } }));
    const envelope = row.pack as unknown as CbtPackEnvelope;
    // The envelope is public: no question text, no names, in the clear.
    const publicText = JSON.stringify(envelope);
    expect(publicText).not.toContain("Velocity");
    expect(publicText).not.toContain("Okafor");
    expect(envelope).toMatchObject({ format: "school-kit-cbt-pack/1", candidateCount: 3, title: "Physics online exam" });

    await expect(openPack(envelope, "AAAA-AAAA-AAAA")).rejects.toThrow();
    const payload = await openPack(envelope, sheet.unlockCode.toLowerCase()); // typed loosely still opens

    // D4 — the answer key is nowhere in the pack.
    expect(JSON.stringify(payload)).not.toMatch(/isCorrect|correct/i);
    expect(payload).toMatchObject({ objectiveTotal: 6, questionCount: 3 });
    expect(Object.keys(payload.versions).sort()).toEqual(["A", "B"]);
    expect(payload.candidates.map((c) => c.displayName).sort()).toEqual(["Ada O.", "Bayo A.", "Chika E."]);

    // Version B's options are in exactly the order its printed paper uses.
    const items = await withTenant(S.schoolId, (db) =>
      db.examPaperItem.findMany({
        where: { paperId: S.paperId, question: { type: "MULTIPLE_CHOICE" } },
        include: { question: { include: { options: { orderBy: { orderIndex: "asc" } } } } },
      }),
    );
    for (const q of payload.versions.B![0]!.questions) {
      const item = items.find((i) => i.id === q.itemId)!;
      const order = optionOrderFor("B", `${S.paperId}:${item.id}`, item.question.options.length);
      expect(q.options.map((o) => o.id)).toEqual(order.map((i) => item.question.options[i]!.id));
    }
    // Theory stays on paper.
    expect(JSON.stringify(payload)).not.toContain("Derive v = u + at.");

    const viewed = await withTenant(S.schoolId, (db) => db.auditLog.count({ where: { entityId: draft.id, action: "cbt-sitting.view-codes" } }));
    expect(viewed).toBe(1);
  });

  it("a published sitting can't be edited; it can go back to draft before the start, not after", async () => {
    const draft = await newSitting();
    await service.publish(teacher(), draft.id, meta);
    await expect(
      service.update(teacher(), draft.id, { title: "x", classArmIds: [S.armId], ...times() }, meta),
    ).rejects.toMatchObject({ code: "SITTING_NOT_DRAFT" });

    const back = await service.unpublish(teacher(), draft.id, meta);
    expect(back).toMatchObject({ status: "DRAFT", packBuiltAt: null, candidateCount: 3 });
    expect(await withTenant(S.schoolId, (db) => db.cbtCandidate.count({ where: { sittingId: draft.id } }))).toBe(0);

    await service.publish(teacher(), draft.id, meta);
    await withTenant(S.schoolId, (db) => db.cbtSitting.update({ where: { id: draft.id }, data: { startsAt: new Date(Date.now() - hour) } }));
    await expect(service.unpublish(teacher(), draft.id, meta)).rejects.toMatchObject({ code: "SITTING_STARTED" });

    const closed = await service.close(teacher(), draft.id, meta);
    expect(closed.status).toBe("CLOSED");
    await expect(service.close(teacher(), draft.id, meta)).rejects.toBeInstanceOf(ConflictError);
  });

  it("a draft can be edited and deleted", async () => {
    const draft = await newSitting();
    const edited = await service.update(teacher(), draft.id, { title: "Renamed", classArmIds: [S.armId], ...times(48) }, meta);
    expect(edited.title).toBe("Renamed");
    await service.remove(teacher(), draft.id, meta);
    await expect(service.get(teacher(), draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
