import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import {
  ASSIGNMENT_FEEDBACK_PROMPT,
  ASSIGNMENT_FEEDBACK_SCHEMA,
  ASSIGNMENT_FEEDBACK_SYSTEM,
  removeNames,
  renderAssignmentFeedbackPrompt,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  BaseError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ASSIGNMENT_LIMITS,
  planFeatureAvailable,
  type AiMarkingSettingsDto,
  type DraftFeedbackResultDto,
  type SchoolPlan,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { AI_ERROR_CODES } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { currentPlanEnforcement } from "../../common/plans/plan-limits.js";
import { AI_JOB_ASSIGNMENT_FEEDBACK, AI_QUEUE, queueJobId } from "../../common/queue/index.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// ---------------------------------------------------------------------------
// Phase 9 / CP4b — AI-drafted marking feedback (docs/modules/phase-9.md §12).
//
// OPTIONAL AT EVERY LEVEL (owner, 2026-10-16). Marking by hand never changes.
// A draft is offered only when ALL of these hold, and every one is re-checked
// when the job runs, not only when it is queued:
//   1. the platform's per-school switch, School.aiEnabled;
//   2. the school's own switch, School.assignmentFeedbackAiEnabled (off by
//      default, set by owner or admin);
//   3. the plan includes aiMarkingFeedback (under PLAN_ENFORCEMENT=enforce);
//   4. AI is configured on this deployment;
// and then only when a teacher presses the button.
//
// A DRAFT IS NEVER A MARK (CLAUDE.md: never auto-finalise AI output for
// grades). Drafts live in assignment_feedback_drafts; only the teacher's own
// "Save mark" writes a mark, and it records feedbackAiDrafted.
//
// PII (CLAUDE.md allowlist, second row, `assignment-feedback`): the answer is
// the payload; the renderer removes the student's names and admission number
// and every classmate's names. The QUEUE JOB CARRIES IDS ONLY — the answer is
// read from the attempt when the job runs, so it never sits in Redis.
//
// No model call inside a transaction (phase-5.md D1): read (tx) → call (no tx)
// → write (tx), as report comments do.
// ---------------------------------------------------------------------------

const AUDIT = {
  enabled: "assignment.ai-drafts.enabled",
  disabled: "assignment.ai-drafts.disabled",
  request: "assignment.ai-draft.request",
  discard: "assignment.ai-draft.discard",
} as const;

const STAFF_ROLES = ["owner", "admin", "teacher"];

export interface AssignmentFeedbackJobData {
  schoolId: string;
  userId: string;
  submissionId: string;
}

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Why a draft failed, in words a teacher can read. */
export function failureText(err: unknown): string {
  if (err instanceof BaseError) {
    switch (err.code) {
      case AI_ERROR_CODES.BUDGET_EXCEEDED:
        return "The school's AI allowance for this month is used up. Mark this one by hand.";
      case AI_ERROR_CODES.USER_RATE_LIMITED:
        return "You've reached today's limit for AI drafts. Try again tomorrow, or mark by hand.";
      case AI_ERROR_CODES.DISABLED_SCHOOL:
      case AI_ERROR_CODES.DISABLED_PLATFORM:
      case "AI_DRAFTS_OFF":
        return "AI drafts are switched off for this school.";
      case AI_ERROR_CODES.NOT_CONFIGURED:
        return "AI is not set up on this system.";
    }
  }
  return "The draft could not be made. Try again, or mark by hand.";
}

/** The model's answer, checked: a whole mark within the total, feedback and a reason. */
export function parseDraft(
  text: string,
  totalMarks: number,
): { mark: number; feedback: string; reason: string } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.mark !== "number" || !Number.isInteger(r.mark) || r.mark < 0 || r.mark > totalMarks) return null;
  if (typeof r.feedback !== "string" || r.feedback.trim() === "") return null;
  return {
    mark: r.mark,
    feedback: r.feedback.trim().slice(0, ASSIGNMENT_LIMITS.feedback),
    reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 500) : "",
  };
}

@Injectable()
export class AssignmentFeedbackService {
  private readonly logger = new Logger(AssignmentFeedbackService.name);

  constructor(
    private readonly ai: AiGenerationService,
    @InjectQueue(AI_QUEUE) private readonly queue: Queue,
  ) {}

  // =========================================================================
  // GET/PUT /assignments/ai-drafts/settings — the school's own switch
  // =========================================================================
  async getSettings(authCtx: AuthContext): Promise<AiMarkingSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, (db) => this.readSettings(db, authCtx.schoolId));
  }

  async updateSettings(authCtx: AuthContext, enabled: boolean, ipAddress: string | null): Promise<AiMarkingSettingsDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      await db.school.update({ where: { id: authCtx.schoolId }, data: { assignmentFeedbackAiEnabled: enabled } });
      // Who turned AI near children's work on, and when, must be answerable.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: enabled ? AUDIT.enabled : AUDIT.disabled,
          entityType: "School",
          entityId: authCtx.schoolId,
          ipAddress,
        },
      });
      return this.readSettings(db, authCtx.schoolId);
    });
  }

  /** Whether drafting is offered to this school right now. */
  async available(db: Db, schoolId: string): Promise<boolean> {
    const s = await this.readSettings(db, schoolId);
    return s.enabled && s.aiEnabled && s.planIncludes && s.aiConfigured;
  }

  private async readSettings(db: Db, schoolId: string): Promise<AiMarkingSettingsDto> {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { assignmentFeedbackAiEnabled: true, aiEnabled: true, plan: true },
    });
    return {
      enabled: school?.assignmentFeedbackAiEnabled ?? false,
      aiEnabled: school?.aiEnabled ?? false,
      planIncludes: planFeatureAvailable((school?.plan ?? "FREE") as SchoolPlan, "aiMarkingFeedback", currentPlanEnforcement()),
      aiConfigured: this.ai.isConfigured(),
    };
  }

  private async assertAvailable(db: Db, schoolId: string): Promise<void> {
    if (!(await this.available(db, schoolId))) {
      throw new ForbiddenError("AI_DRAFTS_OFF", "AI drafts of marking feedback are not switched on for this school.");
    }
  }

  // =========================================================================
  // POST /assignments/submissions/:id/ai-draft — one piece of work
  // =========================================================================
  async draftOne(authCtx: AuthContext, submissionId: string, ipAddress: string | null): Promise<DraftFeedbackResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    const queued = await withTenant(authCtx.schoolId, async (db) => {
      await this.assertAvailable(db, authCtx.schoolId);
      const submission = await db.assignmentSubmission.findUnique({
        where: { id: submissionId },
        include: { collection: { include: { assignment: true } }, feedbackDraft: true },
      });
      if (!submission) throw new NotFoundError("That piece of work could not be found.");
      await this.assertInScope(db, authCtx, submission.collection.assignment, isAdmin);
      const newer = await db.assignmentSubmission.count({
        where: { collectionId: submission.collectionId, studentId: submission.studentId, attempt: { gt: submission.attempt } },
      });
      if (newer > 0 || submission.returnedAt) {
        throw new ConflictError("NOT_LATEST_ATTEMPT", "Draft the student's latest attempt.");
      }
      if (!submission.body) {
        throw new ValidationError("Only a typed answer can be drafted. Photos and PDFs are marked by hand.");
      }
      if (submission.feedbackDraft?.status === "PENDING") {
        throw new ConflictError("DRAFT_PENDING", "A draft is already being made for this work.");
      }
      await this.startDraft(db, authCtx, submission.id);
      await this.audit(db, authCtx, AUDIT.request, "assignment_submission", submission.id, ipAddress, { count: 1 });
      return [submission.id];
    });
    await this.enqueue(authCtx, queued);
    return { queued: queued.length };
  }

  // =========================================================================
  // POST /assignments/:id/ai-drafts — every unmarked typed answer without a draft
  // =========================================================================
  async draftAll(authCtx: AuthContext, assignmentId: string, ipAddress: string | null): Promise<DraftFeedbackResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    const queued = await withTenant(authCtx.schoolId, async (db) => {
      await this.assertAvailable(db, authCtx.schoolId);
      const assignment = await db.assignment.findUnique({ where: { id: assignmentId }, include: { collection: true } });
      if (!assignment || !assignment.collection) throw new NotFoundError("Work is not being collected for that homework.");
      await this.assertInScope(db, authCtx, assignment, isAdmin);
      // Unmarked and not returned is always a student's latest attempt.
      const rows = await db.assignmentSubmission.findMany({
        where: {
          collectionId: assignment.collection.id,
          markedAt: null,
          returnedAt: null,
          body: { not: null },
          feedbackDraft: { is: null },
        },
        select: { id: true },
      });
      for (const r of rows) await this.startDraft(db, authCtx, r.id);
      if (rows.length > 0) {
        await this.audit(db, authCtx, AUDIT.request, "homework", assignmentId, ipAddress, { count: rows.length });
      }
      return rows.map((r) => r.id);
    });
    await this.enqueue(authCtx, queued);
    return { queued: queued.length };
  }

  // =========================================================================
  // DELETE /assignments/submissions/:id/ai-draft — drop a draft
  // =========================================================================
  async discard(authCtx: AuthContext, submissionId: string, ipAddress: string | null): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    await withTenant(authCtx.schoolId, async (db) => {
      const submission = await db.assignmentSubmission.findUnique({
        where: { id: submissionId },
        include: { collection: { include: { assignment: true } }, feedbackDraft: true },
      });
      if (!submission?.feedbackDraft) throw new NotFoundError("There is no draft for that work.");
      await this.assertInScope(db, authCtx, submission.collection.assignment, isAdmin);
      await db.assignmentFeedbackDraft.delete({ where: { submissionId } });
      await this.audit(db, authCtx, AUDIT.discard, "assignment_submission", submissionId, ipAddress, {});
    });
  }

  // =========================================================================
  // The queue job: read (tx) → call (no tx) → write (tx)
  // =========================================================================
  async generate(job: AssignmentFeedbackJobData): Promise<void> {
    const context = await withTenant(job.schoolId, async (db) => {
      const draft = await db.assignmentFeedbackDraft.findUnique({ where: { submissionId: job.submissionId } });
      // Discarded, or already done: nothing to do.
      if (!draft || draft.status !== "PENDING") return null;
      // Re-checked when the job runs: a school may switch it off in between.
      if (!(await this.available(db, job.schoolId))) return { off: true as const };
      const submission = await db.assignmentSubmission.findUnique({
        where: { id: job.submissionId },
        include: { collection: { include: { assignment: true } } },
      });
      if (!submission?.body) return null;
      const assignment = submission.collection.assignment;
      const [arm, subject, student] = await Promise.all([
        db.classArm.findUnique({ where: { id: assignment.classArmId }, select: { classLevel: { select: { name: true } } } }),
        db.subject.findUnique({ where: { id: assignment.subjectId }, select: { name: true } }),
        db.student.findUnique({
          where: { id: submission.studentId },
          select: { firstName: true, lastName: true, middleName: true, admissionNumber: true },
        }),
      ]);
      // Every name the server knows in this class: those enrolled in the arm
      // and anyone who handed this work in.
      const enrolled = await db.enrollment.findMany({
        where: { classArmId: assignment.classArmId, status: "ENROLLED" },
        select: { student: { select: { firstName: true, lastName: true, middleName: true } } },
      });
      const names = [
        ...(student ? [student.firstName, student.lastName, student.middleName ?? "", student.admissionNumber] : []),
        ...enrolled.flatMap((e) => [e.student.firstName, e.student.lastName, e.student.middleName ?? ""]),
      ].flatMap((n) => [n, ...n.split(/\s+/)]);
      return {
        off: false as const,
        totalMarks: submission.collection.totalMarks,
        userContent: renderAssignmentFeedbackPrompt({
          classLevel: arm?.classLevel.name ?? "secondary",
          subject: subject?.name ?? "",
          title: assignment.title,
          instructions: assignment.instructions,
          markingGuide: submission.collection.markingGuide,
          totalMarks: submission.collection.totalMarks,
          answer: submission.body,
          namesToRemove: names.filter((n) => n.trim() !== ""),
        }),
        names,
      };
    });
    if (!context) return;
    if (context.off) {
      await this.fail(job, "AI drafts are switched off for this school.");
      return;
    }

    let parsed: ReturnType<typeof parseDraft> = null;
    try {
      const result = await this.ai.generate({
        schoolId: job.schoolId,
        userId: job.userId,
        prompt: ASSIGNMENT_FEEDBACK_PROMPT,
        system: ASSIGNMENT_FEEDBACK_SYSTEM,
        userContent: context.userContent,
        jsonSchema: ASSIGNMENT_FEEDBACK_SCHEMA,
      });
      parsed = parseDraft(result.text, context.totalMarks);
    } catch (err) {
      this.logger.warn(`assignment-feedback: draft for ${job.submissionId} failed: ${err instanceof Error ? err.message : "unknown"}`);
      await this.fail(job, failureText(err));
      return;
    }
    if (!parsed) {
      await this.fail(job, "The draft could not be made. Try again, or mark by hand.");
      return;
    }
    const draft = parsed;
    await withTenant(job.schoolId, async (db) => {
      // Belt and braces: never show a teacher a name the model put back.
      await db.assignmentFeedbackDraft.updateMany({
        where: { submissionId: job.submissionId, status: "PENDING" },
        data: {
          status: "READY",
          mark: draft.mark,
          feedback: removeNames(draft.feedback, context.names),
          reason: draft.reason ? removeNames(draft.reason, context.names) : null,
          failure: null,
        },
      });
    });
  }

  // =========================================================================

  private async startDraft(db: Db, authCtx: AuthContext, submissionId: string): Promise<void> {
    const data = {
      status: "PENDING" as const,
      mark: null,
      feedback: null,
      reason: null,
      failure: null,
      promptVersion: ASSIGNMENT_FEEDBACK_PROMPT.version,
      requestedBy: authCtx.userId,
    };
    await db.assignmentFeedbackDraft.upsert({
      where: { submissionId },
      create: { schoolId: authCtx.schoolId, submissionId, ...data },
      update: data,
    });
  }

  private async enqueue(authCtx: AuthContext, submissionIds: readonly string[]): Promise<void> {
    const stamp = String(Date.now());
    for (const submissionId of submissionIds) {
      // Ids only: the answer is read when the job runs (allowlist rule 1).
      const data: AssignmentFeedbackJobData = { schoolId: authCtx.schoolId, userId: authCtx.userId, submissionId };
      await this.queue.add(AI_JOB_ASSIGNMENT_FEEDBACK, data, {
        jobId: queueJobId("assignment-feedback", submissionId, stamp),
        // Each retry is a paid call; a failure is shown to the teacher, who can
        // press again. One attempt.
        attempts: 1,
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      });
    }
  }

  private async fail(job: AssignmentFeedbackJobData, failure: string): Promise<void> {
    await withTenant(job.schoolId, (db) =>
      db.assignmentFeedbackDraft.updateMany({
        where: { submissionId: job.submissionId, status: "PENDING" },
        data: { status: "FAILED", failure },
      }),
    );
  }

  private async assertInScope(
    db: Db,
    authCtx: AuthContext,
    assignment: { classArmId: string; subjectId: string },
    isAdmin: boolean,
  ): Promise<void> {
    if (isAdmin) return;
    const scope = await getTeacherScope(db as never, authCtx.userId);
    const subjects = scope.subjectsByArm.get(assignment.classArmId) ?? [];
    if (!subjects.some((s) => s.id === assignment.subjectId)) {
      throw new ForbiddenError("You can only work on a class and subject you teach.");
    }
  }

  private audit(
    db: Db,
    authCtx: AuthContext,
    action: string,
    entityType: string,
    entityId: string,
    ipAddress: string | null,
    metadata: Record<string, number>,
  ) {
    // Counts and ids only: never the answer, the draft or the feedback.
    return db.auditLog.create({
      data: { schoolId: authCtx.schoolId, userId: authCtx.userId, action, entityType, entityId, ipAddress, metadata },
    });
  }

  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }
}
