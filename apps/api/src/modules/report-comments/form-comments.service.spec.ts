import type { ConfigService } from "@nestjs/config";
import type { Queue } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  REPORT_CARD_FORM_COMMENT_SCHEMA,
  type AiCallRequest,
  type AiCallResult,
  type AnthropicPort,
} from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import {
  FormCommentsService,
  formCommentSessionRef,
  type FormCommentJobData,
} from "./form-comments.service.js";

// Integration suite against real Postgres, Anthropic faked.
//
// The assertion this file exists for is the same as slice 3's, one level up: a
// generation must NEVER write ReportCard.formTeacherComment. Unlike slice 3,
// this service has no write path at all — acceptance goes through the Phase 2
// workflow endpoint — so the test proves the absence rather than the gate.

const SUGGESTION =
  "A steady term overall, strongest in Mathematics with English Language now holding the average down.";

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  behaviour: "ok" | "empty" = "ok";

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    const text = this.behaviour === "empty" ? JSON.stringify({ comment: "" }) : JSON.stringify({ comment: SUGGESTION });
    return { text, inputTokens: 200, outputTokens: 60, stopReason: "end_turn" };
  }
}

class FakeQueue {
  added: Array<{ name: string; data: FormCommentJobData; opts?: { jobId?: string } }> = [];
  async add(name: string, data: FormCommentJobData, opts?: { jobId?: string }): Promise<unknown> {
    this.added.push({ name, data, opts });
    return { id: opts?.jobId ?? "job" };
  }
}

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const runId = Math.random().toString(36).slice(2, 8);

let schoolId: string;
let adminId: string;
let formTeacherId: string;
let otherTeacherId: string;
let armId: string;
let termId: string;
let yearId: string;
let draftCardId: string;
let draftStudentId: string;
let lockedStudentId: string;
let emptyStudentId: string;

let port: FakePort;
let queue: FakeQueue;
let service: FormCommentsService;

function ctx(userId: string): AuthContext {
  return { schoolId, userId } as AuthContext;
}

function jobFor(studentId: string, reportCardId: string): FormCommentJobData {
  return {
    schoolId,
    userId: adminId,
    studentId,
    termId,
    classArmId: armId,
    reportCardId,
    sessionRef: formCommentSessionRef({ termId, classArmId: armId }),
  };
}

describe("FormCommentsService", () => {
  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: {
        name: `FC ${runId}`,
        slug: `fc-${runId}`,
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

    const roleId = async (key: "admin" | "teacher") =>
      (await basePrisma.role.findFirstOrThrow({ where: { schoolId: null, key, isSystem: true }, select: { id: true } })).id;
    const adminRoleId = await roleId("admin");
    const teacherRoleId = await roleId("teacher");

    await withTenant(schoolId, async (db) => {
      const mkUser = async (first: string, roleIdValue: string) => {
        const u = await db.user.create({
          data: { schoolId, email: `${first.toLowerCase()}-${runId}@t.test`, firstName: first, lastName: "User" },
          select: { id: true },
        });
        await db.userRole.create({ data: { userId: u.id, roleId: roleIdValue } });
        return u.id;
      };
      adminId = await mkUser("Ada", adminRoleId);
      formTeacherId = await mkUser("Form", teacherRoleId);
      otherTeacherId = await mkUser("Other", teacherRoleId);

      const level = await db.classLevel.create({
        data: { schoolId, name: "SS 2", code: `SS2-${runId}`, stage: "SSS", orderIndex: 8 },
        select: { id: true },
      });
      // The form teacher is set on the arm — that is what the guard keys off.
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: "SS 2 A",
          code: `ss2a-${runId}`,
          classTeacherId: formTeacherId,
        },
        select: { id: true },
      });
      armId = arm.id;

      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
        select: { id: true },
      });
      yearId = year.id;
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          name: "Second Term",
          sequence: 2,
          startDate: new Date("2026-01-10"),
          endDate: new Date("2026-04-10"),
        },
        select: { id: true },
      });
      termId = term.id;

      const maths = await db.subject.create({
        data: { schoolId, name: "Mathematics", code: `math-${runId}` },
        select: { id: true },
      });
      const english = await db.subject.create({
        data: { schoolId, name: "English Language", code: `eng-${runId}` },
        select: { id: true },
      });

      const mkStudent = async (first: string, n: number) => {
        const s = await db.student.create({
          data: {
            schoolId,
            firstName: first,
            lastName: `Learner-${runId}`,
            admissionNumber: `ADM-${runId}-${n}`,
            dateOfBirth: new Date("2010-02-03"),
            gender: "MALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: { schoolId, studentId: s.id, termId, academicYearId: yearId, classArmId: armId },
        });
        return s.id;
      };
      draftStudentId = await mkStudent("Chidi", 1);
      lockedStudentId = await mkStudent("Ngozi", 2);
      emptyStudentId = await mkStudent("Bola", 3);

      const mkAssessment = async (studentId: string, subjectId: string, total: number, grade: string) =>
        db.assessment.create({
          data: {
            schoolId,
            studentId,
            subjectId,
            termId,
            academicYearId: yearId,
            classArmId: armId,
            totalScore: total,
            letterGrade: grade,
            computedAt: new Date(),
          },
        });
      await mkAssessment(draftStudentId, maths.id, 78, "B");
      await mkAssessment(draftStudentId, english.id, 43, "E");
      await mkAssessment(lockedStudentId, maths.id, 65, "C");

      const mkCard = async (studentId: string, status: "DRAFT" | "FORM_REVIEWED", subjectsCount: number) =>
        (
          await db.reportCard.create({
            data: {
              schoolId,
              studentId,
              termId,
              academicYearId: yearId,
              classArmId: armId,
              status,
              overallAverage: 6050,
              overallPosition: 7,
              subjectsCount,
              ...(status === "FORM_REVIEWED"
                ? { formReviewedAt: new Date(), formReviewedBy: adminId }
                : {}),
            },
            select: { id: true },
          })
        ).id;
      draftCardId = await mkCard(draftStudentId, "DRAFT", 2);
      await mkCard(lockedStudentId, "FORM_REVIEWED", 1);
      await mkCard(emptyStudentId, "DRAFT", 0);

      // 7 of 10 days attended for the draft student — under the 85% line the
      // prompt treats as worth mentioning.
      for (let i = 0; i < 10; i += 1) {
        await db.attendanceRecord.create({
          data: {
            schoolId,
            studentId: draftStudentId,
            classArmId: armId,
            termId,
            date: new Date(Date.UTC(2026, 0, i + 12)),
            status: i < 7 ? "PRESENT" : "ABSENT",
            markedBy: adminId,
          },
        });
      }
    });
  });

  beforeEach(() => {
    port = new FakePort();
    queue = new FakeQueue();
    service = new FormCommentsService(new AiGenerationService(configStub(), port), queue as unknown as Queue);
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
  // The approval gate — proven by absence
  // =========================================================================
  it("a generation writes a suggestion and does NOT touch formTeacherComment", async () => {
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));

    const [card, logs] = await withTenant(schoolId, async (db) => [
      await db.reportCard.findUniqueOrThrow({
        where: { id: draftCardId },
        select: { formTeacherComment: true, status: true },
      }),
      await db.aIInteractionLog.findMany({ where: { studentId: draftStudentId } }),
    ]);

    // The write path for this field is PATCH /report-cards/:id, which this
    // service deliberately does not call and cannot reach.
    expect(card.formTeacherComment).toBeNull();
    expect(card.status).toBe("DRAFT");
    expect(logs).toHaveLength(1);
    expect((logs[0].payload as { comment?: string }).comment).toBe(SUGGESTION);
  });

  // =========================================================================
  // Inputs: whole-child, and no PII
  // =========================================================================
  it("sends every subject, the overall figures and attendance — and no student PII", async () => {
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));
    const sent = port.calls[0].userContent;

    expect(sent).toContain("SS 2");
    expect(sent).toContain("Second Term");
    expect(sent).toContain("Mathematics");
    expect(sent).toContain("English Language");
    expect(sent).toContain("Overall average: 61%"); // 6050 hundredths
    expect(sent).toContain("Attendance this term: 70%");

    expect(sent).not.toContain("Chidi");
    expect(sent).not.toContain(`Learner-${runId}`);
    expect(sent).not.toContain(`ADM-${runId}`);
    expect(sent).not.toMatch(/admission|date of birth|guardian/i);
  });

  it("orders subjects strongest-first so the model can name them without arithmetic", async () => {
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));
    const sent = port.calls[0].userContent;
    expect(sent.indexOf("Mathematics")).toBeLessThan(sent.indexOf("English Language"));
  });

  it("requests structured output", async () => {
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));
    expect(port.calls[0].jsonSchema).toEqual(REPORT_CARD_FORM_COMMENT_SCHEMA);
  });

  it("writes one ai_generations ledger row per generation", async () => {
    const before = await withTenant(schoolId, (db) =>
      db.aIGeneration.count({ where: { schoolId, promptName: "report-card-form-comment" } }),
    );
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));
    const after = await withTenant(schoolId, (db) =>
      db.aIGeneration.count({ where: { schoolId, promptName: "report-card-form-comment" } }),
    );
    expect(after).toBe(before + 1);
  });

  // =========================================================================
  // Eligibility mirrors the workflow's own edit gate
  // =========================================================================
  it("enqueues only cards the form teacher could actually accept", async () => {
    const result = await service.enqueueBatch(ctx(adminId), { classArmId: armId, termId });

    expect(result.queued).toBe(1);
    expect(result.skippedLocked).toBe(1); // FORM_REVIEWED — comment is frozen
    expect(result.skippedNoResults).toBe(1); // subjectsCount 0 — nothing to interpret
    expect(queue.added.map((j) => j.data.studentId)).toEqual([draftStudentId]);
  });

  it("skips a card locked between enqueue and execution, without calling the model", async () => {
    const locked = await withTenant(schoolId, (db) =>
      db.reportCard.findFirstOrThrow({
        where: { studentId: lockedStudentId, termId },
        select: { id: true },
      }),
    );
    await service.generateForStudent(jobFor(lockedStudentId, locked.id));
    expect(port.calls).toHaveLength(0);
  });

  it("uses a stable job id so a double-clicked button cannot double-charge", async () => {
    await service.enqueueBatch(ctx(adminId), { classArmId: armId, termId });
    const first = queue.added[0].opts?.jobId;
    await service.enqueueBatch(ctx(adminId), { classArmId: armId, termId });
    expect(queue.added[1].opts?.jobId).toBe(first);
  });

  // =========================================================================
  // Scope: FORM teacher, not any teacher
  // =========================================================================
  it("allows the arm's form teacher", async () => {
    const rows = await service.list(ctx(formTeacherId), { classArmId: armId, termId });
    expect(rows).toHaveLength(3);
  });

  it("hides the arm from a teacher who is not its form teacher", async () => {
    // The distinction slice 3 does not make: a subject teacher may draft
    // subject comments here but must not draft the form teacher's comment,
    // because only the form teacher can accept it.
    await expect(service.list(ctx(otherTeacherId), { classArmId: armId, termId })).rejects.toMatchObject({
      httpStatus: 404,
      code: "NOT_FOUND",
    });
  });

  // =========================================================================
  // Fail-soft
  // =========================================================================
  it("refuses the whole batch up front when AI is not configured", async () => {
    const unconfigured = new FormCommentsService(
      new AiGenerationService(configStub(), undefined),
      queue as unknown as Queue,
    );
    await expect(
      unconfigured.enqueueBatch(ctx(adminId), { classArmId: armId, termId }),
    ).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    expect(queue.added).toHaveLength(0);
  });

  // =========================================================================
  // The review surface
  // =========================================================================
  it("lists every card with its suggestion, comment and editability", async () => {
    await service.generateForStudent(jobFor(draftStudentId, draftCardId));
    const rows = await service.list(ctx(adminId), { classArmId: armId, termId });

    const draft = rows.find((r) => r.studentId === draftStudentId)!;
    expect(draft.suggestion).toBe(SUGGESTION);
    expect(draft.editable).toBe(true);
    expect(draft.reportCardId).toBe(draftCardId);
    expect(draft.overallAverage).toBe(61);

    const locked = rows.find((r) => r.studentId === lockedStudentId)!;
    expect(locked.editable).toBe(false);
  });

  it("throws rather than storing an empty suggestion", async () => {
    port.behaviour = "empty";
    await expect(service.generateForStudent(jobFor(draftStudentId, draftCardId))).rejects.toThrow(/no comment/i);
  });
});
