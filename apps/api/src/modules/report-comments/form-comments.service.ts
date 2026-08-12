import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import {
  REPORT_CARD_FORM_COMMENT_PROMPT,
  REPORT_CARD_FORM_COMMENT_SCHEMA,
  REPORT_CARD_FORM_COMMENT_SYSTEM,
  renderReportCardFormCommentPrompt,
  type FormCommentSubjectResult,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  ForbiddenError,
  type FormCommentRowDto,
  type GenerateFormCommentsInput,
  type GenerateFormCommentsResultDto,
  type ListFormCommentsInput,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { AI_ERROR_CODES } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { AI_JOB_FORM_COMMENT, AI_QUEUE } from "../../common/queue/index.js";
import { assertOwnerAdminOrFormTeacher } from "../report-cards/workflow/form-teacher-guard.js";

// ---------------------------------------------------------------------------
// Form teacher's report-card comments — Phase 5 / Slice 4.
//
// THIS SERVICE HAS NO WRITE PATH, DELIBERATELY. The teacher-approval gate that
// CLAUDE.md's AI hard rule requires already exists and predates Phase 5:
// `ReportCardWorkflowService.editFormTeacherComment` (PATCH /report-cards/:id)
// enforces owner/admin-or-form-teacher, restricts edits to DRAFT and
// SUBJECT_REVIEWED, re-checks released-card immutability, and writes an
// audit_logs row. Acceptance goes through that endpoint untouched.
//
// So this file only ever writes SUGGESTIONS to ai_interaction_logs (D15). That
// is a smaller slice than the plan assumed, and better: one audited write path
// for the comment rather than two.
//
// Scope is FORM TEACHER, not subject teacher — the opposite of slice 3, and for
// a concrete reason rather than symmetry: only owner/admin/form-teacher can
// accept this field, so generating it for a subject teacher would spend the
// school's budget on a draft they physically cannot save. The check reuses the
// very guard the accept path uses (form-teacher-guard.ts), so the two can't
// drift apart.
//
// Transaction discipline is identical to slice 3 (D1): read (tx) → generate
// (NO tx) → write (tx). Never an LLM call inside withTenant.
// ---------------------------------------------------------------------------

export function formCommentSessionRef(input: { termId: string; classArmId: string }): string {
  return `report-card-form-comment:${input.termId}:${input.classArmId}`;
}

// The two states in which the workflow allows the comment to be edited. Kept
// here as the single list the batch filters on, so "which cards can we usefully
// draft for" always matches "which cards will accept a write".
const EDITABLE_STATUSES = ["DRAFT", "SUBJECT_REVIEWED"] as const;

interface FormSuggestionPayload {
  kind: "report-card-form-comment";
  termId: string;
  classArmId: string;
  reportCardId: string;
  comment: string;
  promptVersion: string;
}

export interface FormCommentJobData {
  schoolId: string;
  userId: string;
  studentId: string;
  termId: string;
  classArmId: string;
  reportCardId: string;
  sessionRef: string;
}

@Injectable()
export class FormCommentsService {
  private readonly logger = new Logger(FormCommentsService.name);

  constructor(
    private readonly ai: AiGenerationService,
    @InjectQueue(AI_QUEUE) private readonly queue: Queue,
  ) {}

  // =========================================================================
  // POST /report-card-comments/form/generate
  // =========================================================================
  async enqueueBatch(
    authCtx: AuthContext,
    input: GenerateFormCommentsInput,
  ): Promise<GenerateFormCommentsResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    // Pre-flight before anything is enqueued — the lesson slice 3 learned in
    // browser verification: an async batch on an unconfigured deployment
    // otherwise reports "queued: 40" and then fails silently on the worker,
    // leaving the teacher watching progress that can never complete.
    if (!this.ai.isConfigured()) {
      throw new ForbiddenError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        "AI is not configured on this deployment.",
      );
    }

    const sessionRef = formCommentSessionRef(input);

    const eligible = await withTenant(authCtx.schoolId, async (db) => {
      await assertOwnerAdminOrFormTeacher(db, authCtx, input.classArmId);

      const cards = await db.reportCard.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: { id: true, studentId: true, status: true, subjectsCount: true },
      });

      const targets: Array<{ reportCardId: string; studentId: string }> = [];
      let skippedLocked = 0;
      let skippedNoResults = 0;

      for (const card of cards) {
        if (!EDITABLE_STATUSES.includes(card.status as (typeof EDITABLE_STATUSES)[number])) {
          skippedLocked += 1;
          continue;
        }
        if (!card.subjectsCount || card.subjectsCount === 0) {
          skippedNoResults += 1;
          continue;
        }
        targets.push({ reportCardId: card.id, studentId: card.studentId });
      }
      return { targets, skippedLocked, skippedNoResults };
    });

    for (const t of eligible.targets) {
      const data: FormCommentJobData = {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        studentId: t.studentId,
        termId: input.termId,
        classArmId: input.classArmId,
        reportCardId: t.reportCardId,
        sessionRef,
      };
      // Stable job id: a double-clicked button cannot double-charge the budget
      // for the same card.
      await this.queue.add(AI_JOB_FORM_COMMENT, data, {
        jobId: `${sessionRef}:${t.studentId}`,
      });
    }

    return {
      sessionRef,
      queued: eligible.targets.length,
      skippedLocked: eligible.skippedLocked,
      skippedNoResults: eligible.skippedNoResults,
    };
  }

  // =========================================================================
  // GET /report-card-comments/form — review surface + what the UI polls.
  // =========================================================================
  async list(authCtx: AuthContext, input: ListFormCommentsInput): Promise<FormCommentRowDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await assertOwnerAdminOrFormTeacher(db, authCtx, input.classArmId);

      const cards = await db.reportCard.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: {
          id: true,
          studentId: true,
          status: true,
          formTeacherComment: true,
          overallAverage: true,
          overallPosition: true,
        },
      });
      if (cards.length === 0) return [];

      const logs = await db.aIInteractionLog.findMany({
        where: {
          sessionRef: formCommentSessionRef(input),
          studentId: { in: cards.map((c) => c.studentId) },
        },
        select: { studentId: true, payload: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      const latest = new Map<string, { comment: string; createdAt: Date }>();
      for (const log of logs) {
        if (!log.studentId || latest.has(log.studentId)) continue;
        const comment = this.readSuggestion(log.payload);
        if (comment) latest.set(log.studentId, { comment, createdAt: log.createdAt });
      }

      return cards.map((card) => {
        const s = latest.get(card.studentId);
        return {
          studentId: card.studentId,
          reportCardId: card.id,
          suggestion: s?.comment ?? null,
          suggestedAt: s?.createdAt ?? null,
          comment: card.formTeacherComment,
          editable: EDITABLE_STATUSES.includes(card.status as (typeof EDITABLE_STATUSES)[number]),
          // Stored in hundredths (7350 = 73.50%); the DTO carries whole
          // percent, which is all a comment-review screen needs.
          overallAverage: card.overallAverage === null ? null : Math.round(card.overallAverage / 100),
          overallPosition: card.overallPosition,
        };
      });
    });
  }

  // =========================================================================
  // The generation. Called by the processor only. Three phases (D1).
  // =========================================================================
  async generateForStudent(job: FormCommentJobData): Promise<void> {
    // ---- 1. read ----------------------------------------------------------
    const context = await withTenant(job.schoolId, async (db) => {
      const card = await db.reportCard.findUnique({
        where: { id: job.reportCardId },
        select: { status: true, overallAverage: true, overallPosition: true },
      });
      // Locked between enqueue and execution — a real race on a batch that
      // takes minutes. Drop the job rather than drafting something unusable.
      if (!card || !EDITABLE_STATUSES.includes(card.status as (typeof EDITABLE_STATUSES)[number])) {
        return null;
      }

      const [assessments, classSize, attendance, arm, term] = await Promise.all([
        db.assessment.findMany({
          where: { studentId: job.studentId, termId: job.termId },
          // Assessment.subjectId is a plain scoping column, NOT a declared
          // Prisma relation (same convention as its other denormalised ids), so
          // subject names are resolved in a second query below rather than by
          // a nested select.
          select: { totalScore: true, letterGrade: true, subjectId: true },
        }),
        db.enrollment.count({ where: { termId: job.termId, classArmId: job.classArmId } }),
        db.attendanceRecord.findMany({
          where: { studentId: job.studentId, termId: job.termId },
          select: { status: true },
        }),
        db.classArm.findUnique({
          where: { id: job.classArmId },
          select: { classLevel: { select: { name: true } } },
        }),
        db.term.findUnique({ where: { id: job.termId }, select: { name: true } }),
      ]);

      if (!arm || !term) return null;

      const subjectNames = new Map(
        (
          await db.subject.findMany({
            where: { id: { in: assessments.map((a) => a.subjectId) } },
            select: { id: true, name: true },
          })
        ).map((s) => [s.id, s.name]),
      );

      const subjects: FormCommentSubjectResult[] = assessments
        .map((a) => ({
          subject: subjectNames.get(a.subjectId) ?? "Unknown subject",
          score: a.totalScore,
          grade: a.letterGrade,
        }))
        // Strongest first: the model is asked to name actual subjects, and an
        // ordered list makes "strong in X, weak in Y" a reading task rather
        // than an arithmetic one.
        .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

      // Same (PRESENT+LATE)/daysMarked policy as AttendanceService and slice 3.
      const daysMarked = attendance.length;
      const attended = attendance.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;

      return {
        classLevel: arm.classLevel.name,
        termName: term.name,
        subjects,
        overallAverage: card.overallAverage === null ? null : Math.round(card.overallAverage / 100),
        overallPosition: card.overallPosition,
        classSize: classSize > 0 ? classSize : null,
        attendanceRate: daysMarked > 0 ? Math.round((attended * 100) / daysMarked) : null,
      };
    });

    if (!context) {
      this.logger.log(
        `form-comment: skipping card ${job.reportCardId} — locked or context missing`,
      );
      return;
    }

    // ---- 2. generate (no transaction open) --------------------------------
    const result = await this.ai.generate({
      schoolId: job.schoolId,
      userId: job.userId,
      prompt: REPORT_CARD_FORM_COMMENT_PROMPT,
      system: REPORT_CARD_FORM_COMMENT_SYSTEM,
      userContent: renderReportCardFormCommentPrompt(context),
      jsonSchema: REPORT_CARD_FORM_COMMENT_SCHEMA,
    });

    const comment = this.parseComment(result.text);
    if (!comment) {
      throw new Error(
        `form-comment: no comment in model output for card ${job.reportCardId} (stop reason: ${result.stopReason ?? "unknown"})`,
      );
    }

    // ---- 3. write (the SUGGESTION only — never the report card) ------------
    const payload: FormSuggestionPayload = {
      kind: "report-card-form-comment",
      termId: job.termId,
      classArmId: job.classArmId,
      reportCardId: job.reportCardId,
      comment,
      promptVersion: REPORT_CARD_FORM_COMMENT_PROMPT.version,
    };

    await withTenant(job.schoolId, async (db) => {
      await db.aIInteractionLog.create({
        data: {
          schoolId: job.schoolId,
          studentId: job.studentId,
          sessionRef: job.sessionRef,
          payload: { ...payload },
        },
      });
    });
  }

  private parseComment(text: string): string | null {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && "comment" in parsed) {
        const value = (parsed as { comment: unknown }).comment;
        if (typeof value === "string" && value.trim().length > 0) return value.trim();
      }
      return null;
    } catch {
      return trimmed;
    }
  }

  private readSuggestion(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") return null;
    const value = (payload as { comment?: unknown }).comment;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
}
