import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import {
  REPORT_CARD_COMMENT_PROMPT,
  REPORT_CARD_COMMENT_SCHEMA,
  REPORT_CARD_COMMENT_SYSTEM,
  renderReportCardCommentPrompt,
  type ReportCardCommentComponent,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  type AcceptSubjectCommentInput,
  type GenerateSubjectCommentsInput,
  type GenerateSubjectCommentsResultDto,
  type ListSubjectCommentsInput,
  type SubjectCommentRowDto,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { AI_ERROR_CODES } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";
import { AI_JOB_SUBJECT_COMMENT, AI_QUEUE } from "../../common/queue/index.js";
import { assertNoReleasedCards } from "../report-cards/workflow/released-guard.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";

// ---------------------------------------------------------------------------
// Report-card subject comments — Phase 5 / Slice 3.
//
// THE APPROVAL GATE IS THE POINT. CLAUDE.md's AI hard rule: "Never auto-finalise
// AI output for grades, report card comments, or behaviour records. There is
// always a teacher-approval gate." So a generation never touches
// `Assessment.subjectComment`. It writes a SUGGESTION to `ai_interaction_logs`,
// and only an explicit accept — a separate endpoint, a separate permission —
// copies text into the student's record (phase-5.md D15).
//
// That split is also what keeps "was this comment AI-drafted or teacher-written?"
// answerable later, to a school or a regulator. Writing generations straight
// into the column would make that question permanently unanswerable, and it is
// not a question you can retrofit an answer to.
//
// WHY A QUEUE. One arm is one call per student — 40 students is 40 Haiku calls,
// 10-20 minutes of wall clock. That cannot be an HTTP request. The batch
// endpoint enqueues and returns immediately; the UI polls the list endpoint and
// watches suggestions appear.
//
// TRANSACTION DISCIPLINE (phase-5.md D1). No LLM call ever happens inside a
// `withTenant` transaction: withTenant opens a 5s interactive Prisma
// transaction, a generation takes 10-30s, and holding a Neon connection open
// across a network call is what D1 exists to prevent. `generateForStudent`
// below is therefore three phases — read (tx) → generate (NO tx) → write (tx) —
// exactly the shape RenderService already uses to put a Chromium render between
// two short transactions. It is NOT wrapped in `tenantWorker`, which would put
// the whole job inside one transaction; see the processor for the same note.
// ---------------------------------------------------------------------------

// Groups one batch's suggestion rows. Stable for a given (term, arm, subject)
// so a re-run replaces the previous batch rather than accumulating orphan rows
// nobody can attribute. `ai_interaction_logs.session_ref` is a loose grouping
// key whose shape Phase 5 owns — this is that shape for this feature.
export function subjectCommentSessionRef(input: {
  termId: string;
  classArmId: string;
  subjectId: string;
}): string {
  return `report-card-subject-comment:${input.termId}:${input.classArmId}:${input.subjectId}`;
}

// What a suggestion row carries. MUST stay PII-free (the table's own contract):
// opaque ids, plus the generated text — which the prompt forbids from
// containing a name, and which the model was never given one to use.
interface SuggestionPayload {
  kind: "report-card-subject-comment";
  subjectId: string;
  termId: string;
  classArmId: string;
  comment: string;
  promptVersion: string;
}

export interface SubjectCommentJobData {
  schoolId: string;
  userId: string;
  studentId: string;
  subjectId: string;
  termId: string;
  classArmId: string;
  sessionRef: string;
}

@Injectable()
export class ReportCommentsService {
  private readonly logger = new Logger(ReportCommentsService.name);

  constructor(
    private readonly ai: AiGenerationService,
    @InjectQueue(AI_QUEUE) private readonly queue: Queue,
  ) {}

  // =========================================================================
  // POST /report-card-comments/generate — enqueue one job per eligible student.
  // =========================================================================
  async enqueueBatch(
    authCtx: AuthContext,
    input: GenerateSubjectCommentsInput,
  ): Promise<GenerateSubjectCommentsResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    // Pre-flight, BEFORE anything is enqueued. Without this the fail-soft
    // contract (phase-5.md D11) never reaches the user on this surface: the
    // batch endpoint returns "queued: 40" happily, every job then fails on the
    // worker, and the teacher watches a progress state that can never
    // complete — no error, no recovery. Caught in browser verification, where
    // the spinner span forever; the unit tests could not see it because they
    // stub the port and never exercise the unconfigured path through HTTP.
    //
    // Deliberately the same code and message the synchronous path throws, so
    // "AI is not configured on this deployment" reads identically whether a
    // teacher hits it on a lesson plan or on a comment batch.
    if (!this.ai.isConfigured()) {
      throw new ForbiddenError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        "AI is not configured on this deployment.",
      );
    }

    const sessionRef = subjectCommentSessionRef(input);

    const eligible = await withTenant(authCtx.schoolId, async (db) => {
      await this.assertSubjectInScope(db, authCtx, input.classArmId, input.subjectId);

      const enrollments = await db.enrollment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: { studentId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);
      if (studentIds.length === 0) {
        return { ids: [] as string[], skippedSignedOff: 0, skippedNoScores: 0 };
      }

      // A released card is frozen (Phase 2 slice 6). Generating drafts a
      // teacher then cannot accept would be a dead end, so refuse the batch
      // outright rather than spend budget on it.
      await assertNoReleasedCards(db, input.termId, studentIds);

      const [assessments, scoredRows] = await Promise.all([
        db.assessment.findMany({
          where: { termId: input.termId, subjectId: input.subjectId, studentId: { in: studentIds } },
          select: { studentId: true, subjectSignedOffAt: true },
        }),
        db.assessmentScore.findMany({
          where: { termId: input.termId, subjectId: input.subjectId, studentId: { in: studentIds } },
          select: { studentId: true },
          distinct: ["studentId"],
        }),
      ]);

      const signedOff = new Set(
        assessments.filter((a) => a.subjectSignedOffAt !== null).map((a) => a.studentId),
      );
      const hasScores = new Set(scoredRows.map((s) => s.studentId));

      const ids: string[] = [];
      let skippedSignedOff = 0;
      let skippedNoScores = 0;
      for (const studentId of studentIds) {
        if (signedOff.has(studentId)) {
          skippedSignedOff += 1;
          continue;
        }
        // Nothing to interpret. The prompt forbids inventing figures, so the
        // honest outcome is to not spend a call at all.
        if (!hasScores.has(studentId)) {
          skippedNoScores += 1;
          continue;
        }
        ids.push(studentId);
      }
      return { ids, skippedSignedOff, skippedNoScores };
    });

    for (const studentId of eligible.ids) {
      const data: SubjectCommentJobData = {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        studentId,
        subjectId: input.subjectId,
        termId: input.termId,
        classArmId: input.classArmId,
        sessionRef,
      };
      // jobId makes a double-clicked button idempotent: BullMQ drops a job
      // whose id already exists, so the second click cannot double-charge the
      // school's budget for the same student.
      await this.queue.add(AI_JOB_SUBJECT_COMMENT, data, {
        jobId: `${sessionRef}:${studentId}`,
      });
    }

    return {
      sessionRef,
      queued: eligible.ids.length,
      skippedSignedOff: eligible.skippedSignedOff,
      skippedNoScores: eligible.skippedNoScores,
    };
  }

  // =========================================================================
  // GET /report-card-comments — the teacher's review surface, and what the UI
  // polls while a batch runs.
  // =========================================================================
  async list(authCtx: AuthContext, input: ListSubjectCommentsInput): Promise<SubjectCommentRowDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertSubjectInScope(db, authCtx, input.classArmId, input.subjectId);

      const enrollments = await db.enrollment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: { studentId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);
      if (studentIds.length === 0) return [];

      const [assessments, logs] = await Promise.all([
        db.assessment.findMany({
          where: { termId: input.termId, subjectId: input.subjectId, studentId: { in: studentIds } },
          select: {
            studentId: true,
            subjectComment: true,
            subjectSignedOffAt: true,
            totalScore: true,
            letterGrade: true,
          },
        }),
        db.aIInteractionLog.findMany({
          where: { sessionRef: subjectCommentSessionRef(input), studentId: { in: studentIds } },
          select: { studentId: true, payload: true, createdAt: true },
          // Newest first, then keep the first per student below: a re-run
          // leaves the older row in place as history rather than deleting it.
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const byStudent = new Map(assessments.map((a) => [a.studentId, a]));
      const latestSuggestion = new Map<string, { comment: string; createdAt: Date }>();
      for (const log of logs) {
        if (!log.studentId || latestSuggestion.has(log.studentId)) continue;
        const comment = this.readSuggestion(log.payload);
        if (comment) latestSuggestion.set(log.studentId, { comment, createdAt: log.createdAt });
      }

      return studentIds.map((studentId) => {
        const a = byStudent.get(studentId);
        const s = latestSuggestion.get(studentId);
        return {
          studentId,
          suggestion: s?.comment ?? null,
          suggestedAt: s?.createdAt ?? null,
          comment: a?.subjectComment ?? null,
          signedOffAt: a?.subjectSignedOffAt ?? null,
          totalScore: a?.totalScore ?? null,
          letterGrade: a?.letterGrade ?? null,
        };
      });
    });
  }

  // =========================================================================
  // POST /report-card-comments/accept — THE approval gate. The only path that
  // writes Assessment.subjectComment.
  // =========================================================================
  async accept(
    authCtx: AuthContext,
    input: AcceptSubjectCommentInput,
  ): Promise<SubjectCommentRowDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const assessment = await db.assessment.findFirst({
        where: { studentId: input.studentId, subjectId: input.subjectId, termId: input.termId },
        select: {
          id: true,
          classArmId: true,
          subjectSignedOffAt: true,
          totalScore: true,
          letterGrade: true,
        },
      });
      if (!assessment) {
        throw new NotFoundError("No assessment exists for this student, subject and term.");
      }

      await this.assertSubjectInScope(db, authCtx, assessment.classArmId, input.subjectId);
      await assertNoReleasedCards(db, input.termId, [input.studentId]);

      // Sign-off freezes the comment along with the scores. Refusing here is
      // what makes the sign-off meaningful — a comment that can still change
      // afterwards is not signed off in any useful sense.
      if (assessment.subjectSignedOffAt !== null) {
        throw new ConflictError(
          "SUBJECT_SIGNED_OFF",
          "This subject has been signed off for the student. Reopen it before changing the comment.",
        );
      }

      const updated = await db.assessment.update({
        where: { id: assessment.id },
        data: { subjectComment: input.comment },
        select: {
          studentId: true,
          subjectComment: true,
          subjectSignedOffAt: true,
          totalScore: true,
          letterGrade: true,
        },
      });

      return {
        studentId: updated.studentId,
        suggestion: null,
        suggestedAt: null,
        comment: updated.subjectComment,
        signedOffAt: updated.subjectSignedOffAt,
        totalScore: updated.totalScore,
        letterGrade: updated.letterGrade,
      };
    });
  }

  // =========================================================================
  // The generation itself. Called by the processor, NOT by a controller.
  //
  // Three phases, and the boundaries are load-bearing (phase-5.md D1):
  //   1. read   — short tx, closes before the call
  //   2. generate — NO transaction open (AiGenerationService runs its own
  //                 short reserve/settle transactions around the call)
  //   3. write  — short tx
  // =========================================================================
  async generateForStudent(job: SubjectCommentJobData): Promise<void> {
    // ---- 1. read ----------------------------------------------------------
    const context = await withTenant(job.schoolId, async (db) => {
      const assessment = await db.assessment.findFirst({
        where: { studentId: job.studentId, subjectId: job.subjectId, termId: job.termId },
        select: {
          subjectSignedOffAt: true,
          totalScore: true,
          letterGrade: true,
          remark: true,
          subjectPosition: true,
        },
      });
      // Signed off between enqueue and execution — a real race on a batch that
      // takes minutes. Drop the job rather than generating something nobody
      // can accept.
      if (!assessment || assessment.subjectSignedOffAt !== null) return null;

      const [scores, classSize, attendance, arm, subject] = await Promise.all([
        db.assessmentScore.findMany({
          where: { studentId: job.studentId, subjectId: job.subjectId, termId: job.termId },
          select: { score: true, component: { select: { label: true, weight: true, orderIndex: true } } },
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
        db.subject.findUnique({ where: { id: job.subjectId }, select: { name: true } }),
      ]);

      if (!arm || !subject) return null;

      const components: ReportCardCommentComponent[] = scores
        .slice()
        .sort((a, b) => a.component.orderIndex - b.component.orderIndex)
        .map((s) => ({ label: s.component.label, score: s.score, max: s.component.weight }));

      // (PRESENT + LATE) / daysMarked — the same policy AttendanceService.
      // getSummary applies (Q7 policy i: EXCUSED stays in the denominator as
      // not-attended). Kept consistent deliberately: a comment citing a
      // different attendance figure from the one on the same report card
      // would be indefensible to a parent.
      const daysMarked = attendance.length;
      const attended = attendance.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;

      return {
        classLevel: arm.classLevel.name,
        subject: subject.name,
        components,
        totalScore: assessment.totalScore,
        letterGrade: assessment.letterGrade,
        remark: assessment.remark,
        subjectPosition: assessment.subjectPosition,
        classSize: classSize > 0 ? classSize : null,
        attendanceRate: daysMarked > 0 ? Math.round((attended * 100) / daysMarked) : null,
      };
    });

    if (!context) {
      this.logger.log(
        `subject-comment: skipping student ${job.studentId} — signed off or context missing`,
      );
      return;
    }

    // ---- 2. generate (no transaction open) --------------------------------
    const result = await this.ai.generate({
      schoolId: job.schoolId,
      userId: job.userId,
      prompt: REPORT_CARD_COMMENT_PROMPT,
      system: REPORT_CARD_COMMENT_SYSTEM,
      userContent: renderReportCardCommentPrompt(context),
      jsonSchema: REPORT_CARD_COMMENT_SCHEMA,
    });

    const comment = this.parseComment(result.text);
    if (!comment) {
      // A structured-output response that still has no usable comment is a
      // real outcome (a refusal, or maxTokens hit mid-string). The ledger row
      // is already written by AiGenerationService; throwing here lets BullMQ
      // retry, and an exhausted job simply leaves the student without a
      // suggestion — which the UI shows honestly.
      throw new Error(
        `subject-comment: no comment in model output for student ${job.studentId} (stop reason: ${result.stopReason ?? "unknown"})`,
      );
    }

    // ---- 3. write ---------------------------------------------------------
    const payload: SuggestionPayload = {
      kind: "report-card-subject-comment",
      subjectId: job.subjectId,
      termId: job.termId,
      classArmId: job.classArmId,
      comment,
      promptVersion: REPORT_CARD_COMMENT_PROMPT.version,
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

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Teachers see only what they teach; owners and admins see the whole school.
  // Reuses the same getTeacherScope helper the teacher portal reads from, so
  // "which subjects am I allowed to touch in this arm" has exactly one
  // definition in the codebase.
  private async assertSubjectInScope(
    db: Parameters<Parameters<typeof withTenant>[1]>[0],
    authCtx: AuthContext,
    classArmId: string,
    subjectId: string,
  ): Promise<void> {
    const grants = await db.userRole.findMany({
      where: { userId: authCtx.userId },
      select: { role: { select: { key: true } } },
    });
    const roleKeys = grants.map((g) => g.role.key);
    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;

    const scope = await getTeacherScope(db, authCtx.userId);
    const subjects = scope.subjectsByArm.get(classArmId) ?? [];
    if (!subjects.some((s) => s.id === subjectId)) {
      // 404, not 403: the same not-your-class semantics the teacher portal
      // already uses, so an out-of-scope id can't be probed for existence.
      throw new NotFoundError("This class and subject are not one of yours.");
    }
  }

  // The model returns { comment } under a structured-output schema. Tolerates a
  // bare string too — a schema is a strong constraint, not a guarantee, and the
  // fallback costs one line.
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
