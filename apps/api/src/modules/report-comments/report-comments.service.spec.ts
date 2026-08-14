import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  REPORT_CARD_COMMENT_SCHEMA,
  type AiCallRequest,
  type AiCallResult,
  type AnthropicPort,
} from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import {
  ReportCommentsService,
  subjectCommentSessionRef,
  type SubjectCommentJobData,
} from "./report-comments.service.js";

// Integration suite against the real Postgres with the Anthropic side faked.
//
// The assertion this file exists for: a generation NEVER writes
// Assessment.subjectComment. CLAUDE.md's AI hard rule requires a teacher
// approval gate on report-card comments, and the only mechanical proof of that
// gate is "generate, then check the column is still null". Everything else here
// is supporting cast.

const SUGGESTION = "A firm grasp of the practical work, though the exam paper showed rushed working.";

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  behaviour: "ok" | "empty" | "throw" = "ok";

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    if (this.behaviour === "throw") throw new Error("simulated upstream failure");
    const text = this.behaviour === "empty" ? JSON.stringify({ comment: "" }) : JSON.stringify({ comment: SUGGESTION });
    return { text, inputTokens: 120, outputTokens: 40, stopReason: "end_turn" };
  }
}

class FakeQueue {
  added: Array<{ name: string; data: SubjectCommentJobData; opts?: { jobId?: string } }> = [];
  async add(name: string, data: SubjectCommentJobData, opts?: { jobId?: string }): Promise<unknown> {
    this.added.push({ name, data, opts });
    return { id: opts?.jobId ?? "job" };
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;

const runId = Math.random().toString(36).slice(2, 8);

let schoolId: string;
let adminId: string;
let teacherId: string;
let armId: string;
let subjectId: string;
let termId: string;
let yearId: string;
let componentIds: string[] = [];
// Three students: scored, signed-off, and unscored — the three branches the
// batch endpoint has to tell apart.
let scoredStudentId: string;
let signedOffStudentId: string;
let unscoredStudentId: string;

let port: FakePort;
let queue: FakeQueue;
let service: ReportCommentsService;

function ctx(userId: string): AuthContext {
  return { schoolId, userId } as AuthContext;
}

function jobFor(studentId: string): SubjectCommentJobData {
  return {
    schoolId,
    userId: adminId,
    studentId,
    subjectId,
    termId,
    classArmId: armId,
    sessionRef: subjectCommentSessionRef({ termId, classArmId: armId, subjectId }),
  };
}

describe("ReportCommentsService", () => {
  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: {
        name: `RC ${runId}`,
        slug: `rc-${runId}`,
        aiMonthlyTokenBudget: 5_000_000,
        // aiEnabled explicitly (2026-08-14): School.aiEnabled now defaults
        // FALSE, and every generation in this suite goes through
        // AiGenerationService.reserve(), which throws DISABLED_SCHOOL when it
        // is off. AI being ON is a precondition of what these tests exercise,
        // not an incidental default — same reasoning as the explicit
        // aiMonthlyTokenBudget beside it.
        aiEnabled: true,
      },
      select: { id: true },
    });
    schoolId = school.id;

    const adminRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "admin", isSystem: true },
      select: { id: true },
    });
    const teacherRole = await basePrisma.role.findFirstOrThrow({
      where: { schoolId: null, key: "teacher", isSystem: true },
      select: { id: true },
    });

    await withTenant(schoolId, async (db) => {
      const admin = await db.user.create({
        data: { schoolId, email: `rc-admin-${runId}@t.test`, firstName: "Ada", lastName: "Admin" },
        select: { id: true },
      });
      adminId = admin.id;
      await db.userRole.create({ data: { userId: admin.id, roleId: adminRole.id } });

      const teacher = await db.user.create({
        data: { schoolId, email: `rc-teacher-${runId}@t.test`, firstName: "Tunde", lastName: "Teacher" },
        select: { id: true },
      });
      teacherId = teacher.id;
      await db.userRole.create({ data: { userId: teacher.id, roleId: teacherRole.id } });

      const level = await db.classLevel.create({
        data: { schoolId, name: "JSS 2", code: `JSS2-${runId}`, stage: "JSS", orderIndex: 2 },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: { schoolId, classLevelId: level.id, name: "JSS 2 A", code: `jss2a-${runId}` },
        select: { id: true },
      });
      armId = arm.id;

      const subject = await db.subject.create({
        data: { schoolId, name: "Basic Science", code: `bsc-${runId}` },
        select: { id: true },
      });
      subjectId = subject.id;

      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `Y-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      yearId = year.id;
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          name: "First Term",
          sequence: 1,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      termId = term.id;

      const scheme = await db.gradingScheme.create({
        data: { schoolId, name: `Scheme ${runId}` },
        select: { id: true },
      });
      const ca = await db.gradingComponent.create({
        data: { schoolId, schemeId: scheme.id, key: "ca1", label: "First CA", weight: 40, orderIndex: 1 },
        select: { id: true },
      });
      const exam = await db.gradingComponent.create({
        data: { schoolId, schemeId: scheme.id, key: "exam", label: "Exam", weight: 60, orderIndex: 2 },
        select: { id: true },
      });
      componentIds = [ca.id, exam.id];

      // --- students -------------------------------------------------------
      const mk = async (first: string, admission: string) => {
        const s = await db.student.create({
          data: {
            schoolId,
            firstName: first,
            lastName: `Learner-${runId}`,
            admissionNumber: admission,
            dateOfBirth: new Date("2012-03-04"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId, academicYearId: yearId, classArmId: armId },
        });
        return s.id;
      };
      scoredStudentId = await mk("Chinedu", `ADM-${runId}-1`);
      signedOffStudentId = await mk("Ngozi", `ADM-${runId}-2`);
      unscoredStudentId = await mk("Bola", `ADM-${runId}-3`);

      const score = async (studentId: string, componentId: string, value: number) =>
        db.assessmentScore.create({
          data: { schoolId, studentId, subjectId, termId, componentId, score: value, enteredBy: adminId },
        });
      await score(scoredStudentId, componentIds[0], 28);
      await score(scoredStudentId, componentIds[1], 41);
      await score(signedOffStudentId, componentIds[0], 30);
      await score(signedOffStudentId, componentIds[1], 50);

      const assess = async (studentId: string, total: number, signedOff: boolean) =>
        db.assessment.create({
          data: {
            schoolId,
            studentId,
            subjectId,
            termId,
            academicYearId: yearId,
            classArmId: armId,
            totalScore: total,
            letterGrade: total >= 70 ? "A" : "C",
            remark: total >= 70 ? "Excellent" : "Credit",
            subjectPosition: signedOff ? 1 : 2,
            computedAt: new Date(),
            ...(signedOff ? { subjectSignedOffAt: new Date(), subjectSignedOffBy: adminId } : {}),
          },
        });
      await assess(scoredStudentId, 69, false);
      await assess(signedOffStudentId, 80, true);
      await assess(unscoredStudentId, 0, false);

      // Attendance: 8 of 10 days attended for the scored student.
      for (let i = 0; i < 10; i += 1) {
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: scoredStudentId,
            classArmId: armId,
            termId,
            date: new Date(Date.UTC(2025, 8, i + 1)),
            status: i < 8 ? "PRESENT" : "ABSENT",
            markedBy: adminId,
          },
        });
      }
    });
  });

  beforeEach(() => {
    port = new FakePort();
    queue = new FakeQueue();
    service = new ReportCommentsService(
      new AiGenerationService(configStub(), port),
      queue as unknown as Queue,
    );
  });

  afterAll(async () => {
    if (!schoolId) return;
    await withTenant(schoolId, async (db) => {
      await db.aIGeneration.deleteMany({ where: { schoolId } });
      await db.aIInteractionLog.deleteMany({ where: { schoolId } });
      await db.aIBudgetPeriod.deleteMany({ where: { schoolId } });
    });
    await basePrisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  });

  // =========================================================================
  // The approval gate
  // =========================================================================
  it("a generation writes a suggestion and does NOT touch the report card comment", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));

    const [assessment, logs] = await withTenant(schoolId, async (db) => [
      await db.assessment.findFirstOrThrow({
        where: { studentId: scoredStudentId, subjectId, termId },
        select: { subjectComment: true },
      }),
      await db.aIInteractionLog.findMany({ where: { studentId: scoredStudentId } }),
    ]);

    // THE assertion of this slice. CLAUDE.md: "Never auto-finalise AI output
    // for ... report card comments. There is always a teacher-approval gate."
    expect(assessment.subjectComment).toBeNull();
    expect(logs).toHaveLength(1);
    expect((logs[0].payload as { comment?: string }).comment).toBe(SUGGESTION);
  });

  it("accept — and only accept — writes the comment onto the record", async () => {
    await service.accept(ctx(adminId), {
      studentId: scoredStudentId,
      subjectId,
      termId,
      comment: "Teacher-edited version of the suggestion.",
    });

    const row = await withTenant(schoolId, (db) =>
      db.assessment.findFirstOrThrow({
        where: { studentId: scoredStudentId, subjectId, termId },
        select: { subjectComment: true },
      }),
    );
    expect(row.subjectComment).toBe("Teacher-edited version of the suggestion.");
  });

  // =========================================================================
  // PII — the hard rule, asserted on the wired-up call rather than the renderer
  // =========================================================================
  it("sends scores, attendance and class context to the model — and no student PII", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));
    const sent = port.calls[0].userContent;

    expect(sent).toContain("JSS 2");
    expect(sent).toContain("Basic Science");
    expect(sent).toContain("First CA");
    expect(sent).toContain("Attendance this term: 80%");

    // The student behind this call is "Chinedu Learner-xxx", admission
    // ADM-xxx-1, DOB 2012-03-04. None of it may appear.
    expect(sent).not.toContain("Chinedu");
    expect(sent).not.toContain(`Learner-${runId}`);
    expect(sent).not.toContain(`ADM-${runId}`);
    expect(sent).not.toContain("2012");
    expect(sent).not.toMatch(/admission|date of birth|guardian/i);
  });

  it("requests structured output so a preamble cannot land in the record", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));
    expect(port.calls[0].jsonSchema).toEqual(REPORT_CARD_COMMENT_SCHEMA);
  });

  it("writes one ai_generations ledger row per generation", async () => {
    const before = await withTenant(schoolId, (db) =>
      db.aIGeneration.count({ where: { schoolId, promptName: "report-card-subject-comment" } }),
    );
    await service.generateForStudent(jobFor(scoredStudentId));
    const after = await withTenant(schoolId, (db) =>
      db.aIGeneration.count({ where: { schoolId, promptName: "report-card-subject-comment" } }),
    );
    expect(after).toBe(before + 1);
  });

  // =========================================================================
  // Sign-off is a hard stop on both paths
  // =========================================================================
  it("refuses to accept a comment once the subject is signed off", async () => {
    await expect(
      service.accept(ctx(adminId), {
        studentId: signedOffStudentId,
        subjectId,
        termId,
        comment: "Too late.",
      }),
    ).rejects.toMatchObject({ code: "SUBJECT_SIGNED_OFF" });
  });

  it("skips a student signed off between enqueue and execution, without calling the model", async () => {
    await service.generateForStudent(jobFor(signedOffStudentId));
    expect(port.calls).toHaveLength(0);
    const logs = await withTenant(schoolId, (db) =>
      db.aIInteractionLog.findMany({ where: { studentId: signedOffStudentId } }),
    );
    expect(logs).toHaveLength(0);
  });

  // =========================================================================
  // Batch eligibility
  // =========================================================================
  it("enqueues only students who are unsigned and actually scored", async () => {
    const result = await service.enqueueBatch(ctx(adminId), { classArmId: armId, subjectId, termId });

    expect(result.queued).toBe(1);
    expect(result.skippedSignedOff).toBe(1);
    expect(result.skippedNoScores).toBe(1);
    expect(queue.added.map((j) => j.data.studentId)).toEqual([scoredStudentId]);
  });

  it("uses a stable per-student job id so a double-clicked button cannot double-charge", async () => {
    await service.enqueueBatch(ctx(adminId), { classArmId: armId, subjectId, termId });
    const first = queue.added[0].opts?.jobId;
    await service.enqueueBatch(ctx(adminId), { classArmId: armId, subjectId, termId });
    // Same id both times — BullMQ drops the duplicate, so the second click
    // cannot spend the budget again.
    expect(queue.added[1].opts?.jobId).toBe(first);
    expect(first).toContain(scoredStudentId);
  });

  it("refuses the whole batch up front when AI is not configured", async () => {
    // Regression test for a bug browser verification caught: because the batch
    // is asynchronous, an unconfigured deployment happily returned "queued: N",
    // every job then failed on the worker, and the teacher was left watching a
    // progress state that could never finish. The refusal has to happen before
    // anything is enqueued, with the same code the synchronous path uses.
    const unconfigured = new ReportCommentsService(
      new AiGenerationService(configStub(), undefined),
      queue as unknown as Queue,
    );

    await expect(
      unconfigured.enqueueBatch(ctx(adminId), { classArmId: armId, subjectId, termId }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(queue.added).toHaveLength(0);
  });

  // =========================================================================
  // Scope
  // =========================================================================
  it("hides another teacher's class behind a 404 rather than a 403", async () => {
    // teacherId teaches nothing: no TeacherAssignment, not the form teacher.
    await expect(
      service.list(ctx(teacherId), { classArmId: armId, subjectId, termId }),
    ).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  // =========================================================================
  // The review surface
  // =========================================================================
  it("lists every enrolled student, pairing suggestions with accepted comments", async () => {
    await service.generateForStudent(jobFor(scoredStudentId));
    const rows = await service.list(ctx(adminId), { classArmId: armId, subjectId, termId });

    expect(rows).toHaveLength(3);
    const scored = rows.find((r) => r.studentId === scoredStudentId)!;
    expect(scored.suggestion).toBe(SUGGESTION);
    expect(scored.letterGrade).toBe("C");

    const signed = rows.find((r) => r.studentId === signedOffStudentId)!;
    expect(signed.signedOffAt).not.toBeNull();
    expect(signed.suggestion).toBeNull();

    const unscored = rows.find((r) => r.studentId === unscoredStudentId)!;
    expect(unscored.suggestion).toBeNull();
  });

  it("throws rather than storing an empty suggestion when the model returns nothing usable", async () => {
    port.behaviour = "empty";
    await expect(service.generateForStudent(jobFor(scoredStudentId))).rejects.toThrow(/no comment/i);
  });
});
