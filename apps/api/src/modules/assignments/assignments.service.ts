import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { withGuardian, withTenant, type Prisma } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  addDaysIso,
  lagosTodayIso,
  isAnswerRight,
  pastedPercent,
  ASSIGNMENT_LIMITS,
  type AnswerResultDto,
  type AssignmentFileUrlDto,
  type AssignmentQuestionDto,
  type BankQuestionListResponse,
  type SetAssignmentQuestionsInput,
  type SimilarityReportDto,
  type AssignmentMarkingDto,
  type AssignmentRosterRowDto,
  type AssignmentSubmissionDto,
  type CollectWorkInput,
  type FamilyAssignmentDto,
  type FamilyAssignmentListResponse,
  type MarkSubmissionInput,
  type MyAssignmentDto,
  type ReturnSubmissionInput,
  type StudentWorkDto,
  type SubmissionFileDto,
  type SubmitWorkInput,
  type WorkStatus,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context.js";
import { assertUserActiveAndHasOneOf, getActiveUserRoleKeys } from "../../common/auth/role-check.js";
import { assertPrivateFile, PRIVATE_FILE_URL_TTL_SECONDS } from "../../common/storage/private-file.js";
import { StorageService } from "../../common/storage/storage.service.js";
import type { PrivateFileExt } from "../../common/storage/storage.types.js";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper.js";
import { AssignmentFeedbackService } from "./assignment-feedback.service.js";
import { findSimilarPairs, promptShingles } from "./similarity.js";

// Phase 9 / CP4 — assignments: submitted work and marking
// (docs/modules/phase-9.md §11).
//
//   - "Collect work" is its own record beside a homework item (CP4-D1); the
//     homework model gains nothing.
//   - Owner, admin and the class's teachers read and mark (CP4-D2). A teacher
//     is held to the class and subject pairs their own teacher scope lists, as
//     homework and the gradebook already are. The bursar holds neither
//     permission.
//   - One row per student per attempt. A submitted attempt is final; a return
//     opens the next one and the old attempt is kept (CP4-D3).
//   - Late is worked out here, on the school's (Lagos) day, never by a phone.
//   - The paste counts (Q7) reach staff only. The student's and the family's
//     shapes have no field for them.
//   - Marks and feedback reach the student and parents only once released
//     (CP4-D7).
//
//   - CP4.3: questions marked by the server (CP4-D6). Multiple choice by
//     option; fill-in by exact match after ignoring case and spacing. The
//     automatic mark is the teacher's starting point, never the mark itself
//     until they save or accept it. The student never receives a right answer.
//   - CP4.4: the similarity check (CP4-D9), for staff only and never stored.
//     The gradebook push needs no code here: the screens send the marks
//     through the gradebook's own preview and save (CP4-D8).
//
// No push or SMS (CP4-D10), and no AI anywhere (Q6). The answer text and the
// feedback never go into the audit log.

const AUDIT = {
  collect: "assignment.collect",
  submit: "assignment.submit",
  mark: "assignment.mark",
  return: "assignment.return",
  release: "assignment.release",
  fileStage: "assignment.file.stage",
  fileRemove: "assignment.file.remove",
  fileRead: "assignment.file.read",
  questions: "assignment.questions.set",
  autoMarks: "assignment.automarks.use",
  similarity: "assignment.similarity.run",
} as const;

const STAFF_ROLES = ["owner", "admin", "teacher"];
/** How far back a family's list looks: marks arrive after the due date. */
const FAMILY_LOOKBACK_DAYS = 60;
/** And how far ahead, matching the homework list. */
const FAMILY_LOOKAHEAD_DAYS = 21;

type Db = Parameters<Parameters<typeof withTenant>[1]>[0];

interface RequestContext {
  ipAddress: string | null;
}

type SubmissionRow = {
  id: string;
  studentId: string;
  attempt: number;
  body: string | null;
  typedChars: number;
  pastedChars: number;
  submittedAt: Date;
  late: boolean;
  mark: number | null;
  feedback: string | null;
  markedBy: string | null;
  markedAt: Date | null;
  releasedAt: Date | null;
  returnedAt: Date | null;
  returnNote: string | null;
};

type AssignmentRow = {
  id: string;
  schoolId: string;
  classArmId: string;
  subjectId: string;
  title: string;
  instructions: string | null;
  dueDate: Date;
  withdrawnAt: Date | null;
};

const asIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

type FileRow = { id: string; ext: string; size: number; submissionId: string | null };
const fileDto = (f: FileRow): SubmissionFileDto => ({ id: f.id, type: f.ext === "pdf" ? "pdf" : "image", size: f.size });
const fullName = (u: { firstName: string; lastName: string }): string => `${u.firstName} ${u.lastName}`;

type QuestionRow = {
  id: string;
  orderIndex: number;
  type: "MULTIPLE_CHOICE" | "FILL_IN";
  text: string;
  marks: number;
  options: Prisma.JsonValue;
  correctIndex: number | null;
  acceptedAnswers: Prisma.JsonValue;
  sourceQuestionId: string | null;
};

const stringList = (value: Prisma.JsonValue): string[] | null =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;

export function questionDto(q: QuestionRow): AssignmentQuestionDto {
  return {
    id: q.id,
    number: q.orderIndex,
    type: q.type,
    text: q.text,
    marks: q.marks,
    options: q.type === "MULTIPLE_CHOICE" ? stringList(q.options) : null,
    correctIndex: q.type === "MULTIPLE_CHOICE" ? q.correctIndex : null,
    acceptedAnswers: q.type === "FILL_IN" ? stringList(q.acceptedAnswers) : null,
    fromBank: q.sourceQuestionId !== null,
  };
}

type Answers = Record<string, number | string>;

const answersOf = (value: Prisma.JsonValue | null): Answers =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Answers) : {};

/** The automatic mark: the marks of every question answered right. */
export function autoMarkOf(questions: readonly AssignmentQuestionDto[], answers: Answers): number {
  return questions.reduce((sum, q) => sum + (isAnswerRight(q, answers[q.id]) ? q.marks : 0), 0);
}

/** One row per question. `reveal` false leaves out whether each was right. */
function answerResults(questions: readonly AssignmentQuestionDto[], answers: Answers, reveal: boolean): AnswerResultDto[] {
  return questions.map((q) => {
    const given = answers[q.id];
    return {
      questionId: q.id,
      number: q.number,
      answer: given === undefined ? null : given,
      correct: reveal ? isAnswerRight(q, given) : null,
    };
  });
}

/**
 * The answers a student sent, checked against the questions: an unknown
 * question, or the wrong kind of answer for one, is refused; blanks are
 * dropped. Returns null when nothing was answered.
 */
export function cleanAnswers(questions: readonly AssignmentQuestionDto[], raw: Answers | undefined): Answers | null {
  if (!raw) return null;
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Answers = {};
  for (const [id, value] of Object.entries(raw)) {
    const q = byId.get(id);
    if (!q) throw new ValidationError("One of those answers is for a question that isn't on this work.");
    if (q.type === "MULTIPLE_CHOICE") {
      if (typeof value !== "number" || value >= (q.options?.length ?? 0)) {
        throw new ValidationError(`Question ${q.number} needs one of its options.`);
      }
      out[id] = value;
    } else {
      if (typeof value !== "string") throw new ValidationError(`Question ${q.number} needs a written answer.`);
      const text = value.trim();
      if (text !== "") out[id] = text;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Where a student stands, from their latest attempt (null when none). */
export function statusOf(latest: Pick<SubmissionRow, "returnedAt" | "markedAt"> | null): WorkStatus {
  if (!latest) return "NOT_SUBMITTED";
  if (latest.returnedAt) return "RETURNED";
  if (latest.markedAt) return "MARKED";
  return "SUBMITTED";
}

/** Late when handed in after the due date's school day. */
export function isLate(dueDate: string, submittedAt: Date): boolean {
  return lagosTodayIso(submittedAt) > dueDate;
}

/**
 * Q7's counts, as the device reported them, clamped to the answer's length so
 * a doctored request cannot claim more characters than the answer holds.
 */
export function clampCounts(length: number, typed: number, pasted: number): { typed: number; pasted: number } {
  const p = Math.min(Math.max(0, pasted), length);
  const t = Math.min(Math.max(0, typed), length - p);
  return { typed: t, pasted: p };
}

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly storage: StorageService,
    // CP4b: whether AI drafting is offered, for the marking page.
    private readonly feedback: AssignmentFeedbackService,
  ) {}

  // =========================================================================
  // PUT /assignments/:id/collection — switch on "collect work", or change it
  // =========================================================================
  async collect(
    authCtx: AuthContext,
    assignmentId: string,
    input: CollectWorkInput,
    reqCtx: RequestContext,
  ): Promise<AssignmentMarkingDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      if (assignment.withdrawnAt) {
        throw new ConflictError("HOMEWORK_WITHDRAWN", "That homework was withdrawn.");
      }
      const existing = await db.assignmentCollection.findUnique({ where: { assignmentId } });
      if (existing) {
        // A total below a mark already given would leave that mark out of range.
        const top = await db.assignmentSubmission.aggregate({
          where: { collectionId: existing.id },
          _max: { mark: true },
        });
        if (top._max.mark !== null && input.totalMarks < top._max.mark) {
          throw new ConflictError(
            "TOTAL_BELOW_MARK",
            `A student already has ${top._max.mark}. The total can't be lower than that.`,
          );
        }
        const questionMarks = await db.assignmentQuestion.aggregate({
          where: { collectionId: existing.id },
          _sum: { marks: true },
        });
        const sum = questionMarks._sum.marks ?? 0;
        if (input.totalMarks < sum) {
          throw new ConflictError(
            "TOTAL_BELOW_QUESTIONS",
            `The questions are worth ${sum} marks. The total can't be lower than that.`,
          );
        }
        await db.assignmentCollection.update({
          where: { id: existing.id },
          data: {
            totalMarks: input.totalMarks,
            ...(input.accepting === undefined ? {} : { accepting: input.accepting }),
            ...(input.markingGuide === undefined ? {} : { markingGuide: input.markingGuide }),
          },
        });
      } else {
        await db.assignmentCollection.create({
          data: {
            schoolId: authCtx.schoolId,
            assignmentId,
            totalMarks: input.totalMarks,
            accepting: input.accepting ?? true,
            markingGuide: input.markingGuide ?? null,
            createdBy: authCtx.userId,
          },
        });
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.collect,
          entityType: "homework",
          entityId: assignmentId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            totalMarks: input.totalMarks,
            accepting: input.accepting ?? existing?.accepting ?? true,
            created: existing === null,
            // Whether there is a guide, never its text.
            ...(input.markingGuide === undefined ? {} : { markingGuide: input.markingGuide !== null }),
          },
        },
      });
      return this.readMarking(db, assignment);
    });
  }

  // =========================================================================
  // GET /assignments/:id/submissions — the marking page
  // =========================================================================
  async marking(authCtx: AuthContext, assignmentId: string): Promise<AssignmentMarkingDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      return this.readMarking(db, assignment);
    });
  }

  // =========================================================================
  // GET /assignments/:id/students/:studentId — one student's attempts
  // =========================================================================
  async studentWork(authCtx: AuthContext, assignmentId: string, studentId: string): Promise<StudentWorkDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      return this.readStudentWork(db, assignmentId, studentId);
    });
  }

  // =========================================================================
  // POST /assignments/submissions/:id/mark
  // =========================================================================
  async mark(
    authCtx: AuthContext,
    submissionId: string,
    input: MarkSubmissionInput,
    reqCtx: RequestContext,
  ): Promise<StudentWorkDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const { submission, collection } = await this.staffSubmission(db, authCtx, submissionId, isAdmin);
      if (submission.returnedAt) {
        throw new ConflictError("SUBMISSION_RETURNED", "That work was returned to the student to do again.");
      }
      if (input.mark > collection.totalMarks) {
        throw new ValidationError(`The mark can't be more than the total, ${collection.totalMarks}.`);
      }
      await db.assignmentSubmission.update({
        where: { id: submissionId },
        data: {
          mark: input.mark,
          feedback: input.feedback ?? null,
          markedBy: authCtx.userId,
          markedAt: new Date(),
          // CP4b: the teacher started from an AI draft. Their save is what makes it a mark.
          feedbackAiDrafted: input.fromAiDraft ?? false,
        },
      });
      // The mark is a number and stays; the feedback text does not go here.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.mark,
          entityType: "assignment_submission",
          entityId: submissionId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            studentId: submission.studentId,
            mark: input.mark,
            outOf: collection.totalMarks,
            feedback: !!input.feedback,
            remark: submission.markedAt !== null,
            released: submission.releasedAt !== null,
            aiDrafted: input.fromAiDraft ?? false,
          },
        },
      });
      return this.readStudentWork(db, collection.assignmentId, submission.studentId);
    });
  }

  // =========================================================================
  // POST /assignments/submissions/:id/return — send it back to be done again
  // =========================================================================
  async returnWork(
    authCtx: AuthContext,
    submissionId: string,
    input: ReturnSubmissionInput,
    reqCtx: RequestContext,
  ): Promise<StudentWorkDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const { submission, collection } = await this.staffSubmission(db, authCtx, submissionId, isAdmin);
      if (submission.returnedAt) {
        throw new ConflictError("SUBMISSION_RETURNED", "That work was already returned.");
      }
      if (submission.markedAt) {
        throw new ConflictError("SUBMISSION_MARKED", "That work is already marked. Change the mark instead.");
      }
      await db.assignmentSubmission.update({
        where: { id: submissionId },
        data: { returnedAt: new Date(), returnedBy: authCtx.userId, returnNote: input.note },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.return,
          entityType: "assignment_submission",
          entityId: submissionId,
          ipAddress: reqCtx.ipAddress,
          metadata: { studentId: submission.studentId, attempt: submission.attempt },
        },
      });
      return this.readStudentWork(db, collection.assignmentId, submission.studentId);
    });
  }

  // =========================================================================
  // POST /assignments/:id/release — the student and parents see the marks
  // =========================================================================
  async release(authCtx: AuthContext, assignmentId: string, reqCtx: RequestContext): Promise<AssignmentMarkingDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      const collection = await this.collectionOf(db, assignmentId);
      // Every marked attempt not yet released. A mark changed after release
      // was released already and simply shows its new value.
      const released = await db.assignmentSubmission.updateMany({
        where: { collectionId: collection.id, markedAt: { not: null }, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      if (released.count === 0) {
        throw new ConflictError("NOTHING_TO_RELEASE", "There are no new marks to release.");
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.release,
          entityType: "homework",
          entityId: assignmentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { released: released.count },
        },
      });
      return this.readMarking(db, assignment);
    });
  }

  // =========================================================================
  // CP4.3 — PUT /assignments/:id/questions: replace the questions, in order
  // =========================================================================
  async setQuestions(
    authCtx: AuthContext,
    assignmentId: string,
    input: SetAssignmentQuestionsInput,
    reqCtx: RequestContext,
  ): Promise<AssignmentMarkingDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      const collection = await this.collectionOf(db, assignmentId);
      // Fixed once anyone has handed in, so an automatic mark never has to be
      // worked out again against different questions.
      const handedIn = await db.assignmentSubmission.count({ where: { collectionId: collection.id } });
      if (handedIn > 0) {
        throw new ConflictError("QUESTIONS_FIXED", "Students have started handing in, so the questions can't change now.");
      }
      const sum = input.questions.reduce((total, q) => total + q.marks, 0);
      if (sum > collection.totalMarks) {
        throw new ConflictError(
          "QUESTIONS_OVER_TOTAL",
          `The questions add up to ${sum} marks, more than the total of ${collection.totalMarks}. Raise the total first.`,
        );
      }
      // A copy from the bank must be an approved multiple-choice question for
      // this class level and subject: the same pair the teacher is held to.
      const sourceIds = [
        ...new Set(
          input.questions.flatMap((q) => (q.type === "MULTIPLE_CHOICE" && q.sourceQuestionId ? [q.sourceQuestionId] : [])),
        ),
      ];
      if (sourceIds.length > 0) {
        const levelId = await this.levelOf(db, assignment.classArmId);
        const found = await db.question.count({
          where: {
            id: { in: sourceIds },
            subjectId: assignment.subjectId,
            classLevelId: levelId,
            type: "MULTIPLE_CHOICE",
            status: "APPROVED",
          },
        });
        if (found !== sourceIds.length) {
          throw new ValidationError("One of those bank questions isn't an approved question for this class and subject.");
        }
      }
      await db.assignmentQuestion.deleteMany({ where: { collectionId: collection.id } });
      if (input.questions.length > 0) {
        await db.assignmentQuestion.createMany({
          data: input.questions.map((q, i) => ({
            schoolId: authCtx.schoolId,
            collectionId: collection.id,
            orderIndex: i + 1,
            type: q.type,
            text: q.text,
            marks: q.marks,
            ...(q.type === "MULTIPLE_CHOICE"
              ? { options: q.options, correctIndex: q.correctIndex, sourceQuestionId: q.sourceQuestionId ?? null }
              : { acceptedAnswers: q.acceptedAnswers }),
          })),
        });
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.questions,
          entityType: "homework",
          entityId: assignmentId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            questions: input.questions.length,
            multipleChoice: input.questions.filter((q) => q.type === "MULTIPLE_CHOICE").length,
            fromBank: sourceIds.length,
            marks: sum,
          },
        },
      });
      return this.readMarking(db, assignment);
    });
  }

  // =========================================================================
  // CP4.3 — GET /assignments/:id/bank-questions: what may be copied in
  // =========================================================================
  async bankQuestions(authCtx: AuthContext, assignmentId: string): Promise<BankQuestionListResponse> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      const levelId = await this.levelOf(db, assignment.classArmId);
      const rows = await db.question.findMany({
        where: { subjectId: assignment.subjectId, classLevelId: levelId, type: "MULTIPLE_CHOICE", status: "APPROVED" },
        include: { options: { orderBy: { orderIndex: "asc" } } },
        orderBy: [{ topic: "asc" }, { createdAt: "asc" }],
        take: 200,
      });
      const data = rows.flatMap((q) => {
        const correct = q.options.map((o, i) => (o.isCorrect ? i : -1)).filter((i) => i >= 0);
        // Only questions that already fit the shape a copy must have.
        if (q.options.length < ASSIGNMENT_LIMITS.optionsMin || q.options.length > ASSIGNMENT_LIMITS.optionsMax) return [];
        if (correct.length !== 1 || q.marks > ASSIGNMENT_LIMITS.questionMarks) return [];
        return [{ id: q.id, topic: q.topic, text: q.text, marks: q.marks, options: q.options.map((o) => o.text), correctIndex: correct[0]! }];
      });
      return { data };
    });
  }

  // =========================================================================
  // CP4.3 — POST /assignments/:id/auto-marks: use the automatic mark as the
  // mark, for work that is answers to questions and nothing else
  // =========================================================================
  async useAutoMarks(authCtx: AuthContext, assignmentId: string, reqCtx: RequestContext): Promise<AssignmentMarkingDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      const collection = await this.collectionOf(db, assignmentId);
      // Unmarked and not returned is always a student's latest attempt. Work
      // with written text or a file still needs a person to read it.
      const rows = await db.assignmentSubmission.findMany({
        where: {
          collectionId: collection.id,
          markedAt: null,
          returnedAt: null,
          autoMark: { not: null },
          body: null,
          files: { none: {} },
        },
        select: { id: true, autoMark: true },
      });
      if (rows.length === 0) {
        throw new ConflictError("NOTHING_TO_MARK", "There is no unmarked work that is only answers to the questions.");
      }
      const now = new Date();
      for (const r of rows) {
        await db.assignmentSubmission.update({
          where: { id: r.id },
          data: { mark: r.autoMark, markedBy: authCtx.userId, markedAt: now },
        });
      }
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.autoMarks,
          entityType: "homework",
          entityId: assignmentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { marked: rows.length, outOf: collection.totalMarks },
        },
      });
      return this.readMarking(db, assignment);
    });
  }

  // =========================================================================
  // CP4.4 — POST /assignments/:id/similarity: which typed answers share a lot
  // of wording. Worked out on request, shown to staff, never stored.
  // =========================================================================
  async similarity(authCtx: AuthContext, assignmentId: string, reqCtx: RequestContext): Promise<SimilarityReportDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const assignment = await this.staffAssignment(db, authCtx, assignmentId, isAdmin);
      const collection = await this.collectionOf(db, assignmentId);
      const rows = await db.assignmentSubmission.findMany({
        where: { collectionId: collection.id, body: { not: null } },
        orderBy: [{ studentId: "asc" }, { attempt: "desc" }],
        select: { studentId: true, body: true },
      });
      // Each student's latest typed answer.
      const latest = new Map<string, string>();
      for (const r of rows) if (!latest.has(r.studentId) && r.body) latest.set(r.studentId, r.body);
      const questions = await this.questionsOf(db, collection.id);
      const prompt = promptShingles([
        assignment.title,
        assignment.instructions ?? "",
        ...questions.flatMap((q) => [q.text, ...(q.options ?? []), ...(q.acceptedAnswers ?? [])]),
      ]);
      const result = findSimilarPairs(
        [...latest].map(([studentId, text]) => ({ studentId, text })),
        prompt,
      );
      const ids = [...new Set(result.pairs.flatMap((p) => [p.a.studentId, p.b.studentId]))];
      const students = await db.student.findMany({
        where: { id: { in: ids } },
        select: { id: true, firstName: true, lastName: true },
      });
      const name = new Map(students.map((s) => [s.id, fullName(s)]));
      // Counts only: no names, no wording.
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.similarity,
          entityType: "homework",
          entityId: assignmentId,
          ipAddress: reqCtx.ipAddress,
          metadata: { compared: result.compared, skippedShort: result.skippedShort, pairs: result.pairs.length },
        },
      });
      return {
        assignmentId,
        compared: result.compared,
        skippedShort: result.skippedShort,
        pairs: result.pairs.map((p) => ({
          overlapPercent: p.overlapPercent,
          a: { ...p.a, name: name.get(p.a.studentId) ?? "" },
          b: { ...p.b, name: name.get(p.b.studentId) ?? "" },
        })),
      };
    });
  }

  // =========================================================================
  // The student's own: GET /student-portal/me/assignments(/:id), POST submit
  // =========================================================================
  async listForStudent(schoolId: string, studentId: string): Promise<FamilyAssignmentListResponse> {
    return withTenant(schoolId, (db) => this.familyList(db, studentId));
  }

  async getForStudent(schoolId: string, studentId: string, assignmentId: string): Promise<MyAssignmentDto> {
    return withTenant(schoolId, async (db) => {
      const { assignment, collection } = await this.studentAssignment(db, studentId, assignmentId);
      return this.readMine(db, assignment, collection, studentId);
    });
  }

  async submitForStudent(
    schoolId: string,
    studentId: string,
    assignmentId: string,
    input: SubmitWorkInput,
  ): Promise<MyAssignmentDto> {
    return withTenant(schoolId, async (db) => {
      const { assignment, collection } = await this.studentAssignment(db, studentId, assignmentId);
      const latest = await db.assignmentSubmission.findFirst({
        where: { collectionId: collection.id, studentId },
        orderBy: { attempt: "desc" },
      });
      const status = statusOf(latest);
      if (status === "SUBMITTED" || status === "MARKED") {
        throw new ConflictError("ALREADY_SUBMITTED", "You have already handed this in.");
      }
      // Returned work may always come back; new work only while it is accepted.
      if (status === "NOT_SUBMITTED" && !collection.accepting) {
        throw new ConflictError("NOT_ACCEPTING", "Your teacher has stopped accepting work for this.");
      }
      const body = input.body?.trim() || null;
      // Staged files (CP4.2) go in with this attempt and become as final as its text.
      const staged = await db.assignmentSubmissionFile.findMany({
        where: { collectionId: collection.id, studentId, submissionId: null },
        select: { id: true },
      });
      const questions = await this.questionsOf(db, collection.id);
      const answers = cleanAnswers(questions, input.answers);
      if (!body && staged.length === 0 && !answers) {
        throw new ValidationError(
          questions.length > 0
            ? "Answer at least one question, write your answer or attach a photo or PDF before handing it in."
            : "Write your answer or attach a photo or PDF before handing it in.",
        );
      }
      const counts = clampCounts(body?.length ?? 0, input.typedChars ?? 0, input.pastedChars ?? 0);
      const now = new Date();
      const attempt = (latest?.attempt ?? 0) + 1;
      // The unique (collection, student, attempt) row is what stops a double
      // tap handing in twice.
      const exists = await db.assignmentSubmission.findUnique({
        where: { collectionId_studentId_attempt: { collectionId: collection.id, studentId, attempt } },
        select: { id: true },
      });
      if (exists) throw new ConflictError("ALREADY_SUBMITTED", "You have already handed this in.");
      const created = await db.assignmentSubmission.create({
        data: {
          schoolId,
          collectionId: collection.id,
          studentId,
          attempt,
          body,
          typedChars: counts.typed,
          pastedChars: counts.pasted,
          submittedAt: now,
          late: isLate(asIsoDate(assignment.dueDate), now),
          // Worked out here, never sent by the phone. Null when there are no questions.
          ...(questions.length > 0
            ? { answers: answers ?? {}, autoMark: autoMarkOf(questions, answers ?? {}) }
            : {}),
        },
        select: { id: true, late: true },
      });
      if (staged.length > 0) {
        await db.assignmentSubmissionFile.updateMany({
          where: { id: { in: staged.map((f) => f.id) } },
          data: { submissionId: created.id },
        });
      }
      await db.auditLog.create({
        data: {
          schoolId,
          userId: studentId,
          action: AUDIT.submit,
          entityType: "assignment_submission",
          entityId: created.id,
          metadata: {
            assignmentId,
            attempt,
            late: created.late,
            files: staged.length,
            text: body !== null,
            answered: answers ? Object.keys(answers).length : 0,
            principal: "student",
          },
        },
      });
      return this.readMine(db, assignment, collection, studentId);
    });
  }

  // =========================================================================
  // Phase 9 / CP4.2 — file answers (Q8). Staged, then handed in with the attempt.
  // =========================================================================

  /** POST /student-portal/me/assignments/:id/files — stage one photo or PDF. */
  async stageFile(schoolId: string, studentId: string, assignmentId: string, buffer: Buffer): Promise<MyAssignmentDto> {
    const kind = assertPrivateFile(buffer);
    const { collection } = await withTenant(schoolId, async (db) => {
      const found = await this.studentAssignment(db, studentId, assignmentId);
      const latest = await db.assignmentSubmission.findFirst({
        where: { collectionId: found.collection.id, studentId },
        orderBy: { attempt: "desc" },
      });
      const status = statusOf(latest);
      if (!(status === "RETURNED" || (status === "NOT_SUBMITTED" && found.collection.accepting))) {
        throw new ConflictError("CANNOT_ATTACH", "You can't add files to this now.");
      }
      const staged = await db.assignmentSubmissionFile.count({
        where: { collectionId: found.collection.id, studentId, submissionId: null },
      });
      if (staged >= ASSIGNMENT_LIMITS.files) {
        throw new ConflictError("TOO_MANY_FILES", `You can attach up to ${ASSIGNMENT_LIMITS.files} files.`);
      }
      return found;
    });
    const id = randomUUID();
    await this.storage.put(schoolId, { kind: "submission-file", fileId: id, ext: kind.ext }, buffer, kind.mime);
    const stored = await withTenant(schoolId, async (db) => {
      // Re-count under a per-student lock: the first count ran before the
      // upload, so parallel requests could all have seen room for one more.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`submission-files:${collection.id}:${studentId}`}))`;
      const stagedNow = await db.assignmentSubmissionFile.count({
        where: { collectionId: collection.id, studentId, submissionId: null },
      });
      if (stagedNow >= ASSIGNMENT_LIMITS.files) return false;
      await db.assignmentSubmissionFile.create({
        data: { id, schoolId, collectionId: collection.id, studentId, ext: kind.ext, size: buffer.length },
      });
      await db.auditLog.create({
        data: {
          schoolId,
          userId: studentId,
          action: AUDIT.fileStage,
          entityType: "assignment_submission_file",
          entityId: id,
          metadata: { assignmentId, type: kind.ext, size: buffer.length, principal: "student" },
        },
      });
      return true;
    });
    if (!stored) {
      await this.storage.delete(schoolId, { kind: "submission-file", fileId: id, ext: kind.ext }).catch(() => undefined);
      throw new ConflictError("TOO_MANY_FILES", `You can attach up to ${ASSIGNMENT_LIMITS.files} files.`);
    }
    return withTenant(schoolId, async (db) => {
      const { assignment } = await this.studentAssignment(db, studentId, assignmentId);
      return this.readMine(db, assignment, collection, studentId);
    });
  }

  /** DELETE /student-portal/me/assignments/:id/files/:fileId — only a staged file. */
  async removeStagedFile(schoolId: string, studentId: string, assignmentId: string, fileId: string): Promise<MyAssignmentDto> {
    const removed = await withTenant(schoolId, async (db) => {
      const { assignment, collection } = await this.studentAssignment(db, studentId, assignmentId);
      const file = await db.assignmentSubmissionFile.findUnique({ where: { id: fileId } });
      if (!file || file.studentId !== studentId || file.collectionId !== collection.id || file.submissionId !== null) {
        throw new NotFoundError("That file could not be found.");
      }
      await db.assignmentSubmissionFile.delete({ where: { id: fileId } });
      await db.auditLog.create({
        data: {
          schoolId,
          userId: studentId,
          action: AUDIT.fileRemove,
          entityType: "assignment_submission_file",
          entityId: fileId,
          metadata: { assignmentId, principal: "student" },
        },
      });
      return { file, dto: await this.readMine(db, assignment, collection, studentId) };
    });
    await this.storage
      .delete(schoolId, { kind: "submission-file", fileId, ext: removed.file.ext as PrivateFileExt })
      .catch(() => undefined);
    return removed.dto;
  }

  /** GET /assignments/files/:fileId — a member of staff opens a handed-in file. */
  async fileUrlForStaff(authCtx: AuthContext, fileId: string, reqCtx: RequestContext): Promise<AssignmentFileUrlDto> {
    await assertUserActiveAndHasOneOf(authCtx, STAFF_ROLES);
    const isAdmin = await this.isAdmin(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const file = await db.assignmentSubmissionFile.findUnique({ where: { id: fileId }, include: { collection: true } });
      // Staged files are the student's own until handed in.
      if (!file || file.submissionId === null) throw new NotFoundError("That file could not be found.");
      await this.staffAssignment(db, authCtx, file.collection.assignmentId, isAdmin);
      await this.auditFileRead(db, authCtx.schoolId, authCtx.userId, file.id, file.studentId, "staff", reqCtx.ipAddress);
      return { url: await this.signFile(authCtx.schoolId, file) };
    });
  }

  /** GET /student-portal/me/assignments/files/:fileId — the student's own, staged or handed in. */
  async fileUrlForStudent(schoolId: string, studentId: string, fileId: string): Promise<AssignmentFileUrlDto> {
    return withTenant(schoolId, async (db) => {
      const file = await db.assignmentSubmissionFile.findUnique({ where: { id: fileId } });
      if (!file || file.studentId !== studentId) throw new NotFoundError("That file could not be found.");
      await this.auditFileRead(db, schoolId, studentId, file.id, studentId, "student", null);
      return { url: await this.signFile(schoolId, file) };
    });
  }

  /** GET /portal/students/:id/assignment-files/:fileId — a linked guardian, handed-in files only. */
  async fileUrlForGuardian(guardianCtx: GuardianAuthContext, studentId: string, fileId: string): Promise<AssignmentFileUrlDto> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, async (db2) => {
        const file = await db2.assignmentSubmissionFile.findUnique({ where: { id: fileId } });
        if (!file || file.studentId !== studentId || file.submissionId === null) {
          throw new NotFoundError("That file could not be found.");
        }
        await this.auditFileRead(db2 as never, guardianCtx.schoolId, guardianCtx.guardianId, file.id, studentId, "guardian", null);
        return { url: await this.signFile(guardianCtx.schoolId, file) };
      }),
    );
  }

  private signFile(schoolId: string, file: { id: string; ext: string }): Promise<string> {
    return this.storage.signUrl(
      schoolId,
      { kind: "submission-file", fileId: file.id, ext: file.ext as PrivateFileExt },
      PRIVATE_FILE_URL_TTL_SECONDS,
    );
  }

  private auditFileRead(
    db: Db,
    schoolId: string,
    userId: string,
    fileId: string,
    studentId: string,
    principal: "staff" | "student" | "guardian",
    ipAddress: string | null,
  ) {
    return db.auditLog.create({
      data: {
        schoolId,
        userId,
        action: AUDIT.fileRead,
        entityType: "assignment_submission_file",
        entityId: fileId,
        ipAddress,
        metadata: { studentId, principal },
      },
    });
  }

  // =========================================================================
  // GET /portal/students/:id/assignments — the parent's read
  // =========================================================================
  async listForGuardian(guardianCtx: GuardianAuthContext, studentId: string): Promise<FamilyAssignmentListResponse> {
    return withTenant(guardianCtx.schoolId, (db) =>
      withGuardian(guardianCtx.guardianId, studentId, db, (db2) => this.familyList(db2 as never, studentId)),
    );
  }

  // =========================================================================

  /** The homework item, if this member of staff may work on it. */
  private async staffAssignment(db: Db, authCtx: AuthContext, assignmentId: string, isAdmin: boolean): Promise<AssignmentRow> {
    const assignment = await db.assignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundError("That homework could not be found.");
    if (!isAdmin) {
      const scope = await getTeacherScope(db as never, authCtx.userId);
      const subjects = scope.subjectsByArm.get(assignment.classArmId) ?? [];
      if (!subjects.some((s) => s.id === assignment.subjectId)) {
        throw new ForbiddenError("You can only see work for a class and subject you teach.");
      }
    }
    return assignment;
  }

  private async questionsOf(db: Db, collectionId: string): Promise<AssignmentQuestionDto[]> {
    const rows = await db.assignmentQuestion.findMany({ where: { collectionId }, orderBy: { orderIndex: "asc" } });
    return rows.map(questionDto);
  }

  private async levelOf(db: Db, classArmId: string): Promise<string> {
    const arm = await db.classArm.findUnique({ where: { id: classArmId }, select: { classLevelId: true } });
    if (!arm) throw new NotFoundError("That class could not be found.");
    return arm.classLevelId;
  }

  private async collectionOf(db: Db, assignmentId: string) {
    const collection = await db.assignmentCollection.findUnique({ where: { assignmentId } });
    if (!collection) throw new NotFoundError("Work is not being collected for that homework.");
    return collection;
  }

  /** A submission a member of staff may mark: it must be the student's latest attempt. */
  private async staffSubmission(db: Db, authCtx: AuthContext, submissionId: string, isAdmin: boolean) {
    const submission = await db.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { collection: true },
    });
    if (!submission) throw new NotFoundError("That piece of work could not be found.");
    await this.staffAssignment(db, authCtx, submission.collection.assignmentId, isAdmin);
    const newer = await db.assignmentSubmission.count({
      where: { collectionId: submission.collectionId, studentId: submission.studentId, attempt: { gt: submission.attempt } },
    });
    if (newer > 0) {
      throw new ConflictError("NOT_LATEST_ATTEMPT", "The student has handed in a newer attempt. Mark that one.");
    }
    return { submission, collection: submission.collection };
  }

  /** The class a student is in now, by their latest enrolment. */
  private async studentArm(db: Db, studentId: string): Promise<string | null> {
    const enrollment = await db.enrollment.findFirst({
      where: { studentId, status: "ENROLLED" },
      orderBy: { enrolledAt: "desc" },
      select: { classArmId: true },
    });
    return enrollment?.classArmId ?? null;
  }

  /** A collected, live homework item for the student's own class; anything else reads as not found. */
  private async studentAssignment(db: Db, studentId: string, assignmentId: string) {
    const armId = await this.studentArm(db, studentId);
    const assignment = await db.assignment.findUnique({ where: { id: assignmentId }, include: { collection: true } });
    if (!assignment || !assignment.collection || assignment.withdrawnAt || assignment.classArmId !== armId) {
      throw new NotFoundError("That work could not be found.");
    }
    return { assignment, collection: assignment.collection };
  }

  private async readMarking(db: Db, assignment: AssignmentRow): Promise<AssignmentMarkingDto> {
    const collection = await this.collectionOf(db, assignment.id);
    const [arm, subject, term] = await Promise.all([
      db.classArm.findUnique({ where: { id: assignment.classArmId }, select: { name: true } }),
      db.subject.findUnique({ where: { id: assignment.subjectId }, select: { name: true } }),
      db.term.findFirst({ where: { isCurrent: true }, select: { id: true } }),
    ]);
    const submissions = await db.assignmentSubmission.findMany({
      where: { collectionId: collection.id },
      orderBy: [{ studentId: "asc" }, { attempt: "desc" }],
      include: { _count: { select: { files: true } }, feedbackDraft: { select: { status: true } } },
    });
    const questions = await this.questionsOf(db, collection.id);
    const latestBy = new Map<
      string,
      SubmissionRow & { autoMark: number | null; feedbackDraft: { status: "PENDING" | "READY" | "FAILED" } | null }
    >();
    const attemptsBy = new Map<string, number>();
    for (const s of submissions) {
      if (!latestBy.has(s.studentId)) latestBy.set(s.studentId, s);
      attemptsBy.set(s.studentId, (attemptsBy.get(s.studentId) ?? 0) + 1);
    }
    // Everyone in the class now, plus anyone who handed in and has since moved.
    const enrolled = await db.enrollment.findMany({
      where: { classArmId: assignment.classArmId, status: "ENROLLED", ...(term ? { termId: term.id } : {}) },
      select: { studentId: true },
    });
    const ids = [...new Set([...enrolled.map((e) => e.studentId), ...latestBy.keys()])];
    const students = await db.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, admissionNumber: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
    const roster: AssignmentRosterRowDto[] = students.map((s) => {
      const latest = latestBy.get(s.id) ?? null;
      return {
        studentId: s.id,
        name: fullName(s),
        admissionNumber: s.admissionNumber,
        status: statusOf(latest),
        latestSubmissionId: latest?.id ?? null,
        attempts: attemptsBy.get(s.id) ?? 0,
        late: latest?.late ?? false,
        mark: latest?.mark ?? null,
        released: latest?.releasedAt != null,
        pastedPercent: latest?.body ? pastedPercent(latest.typedChars, latest.pastedChars) : null,
        fileCount: (latest as { _count?: { files: number } } | null)?._count?.files ?? 0,
        autoMark: latest?.autoMark ?? null,
        draftStatus: latest?.feedbackDraft?.status ?? null,
      };
    });
    return {
      assignmentId: assignment.id,
      title: assignment.title,
      className: arm?.name ?? "",
      subjectName: subject?.name ?? "",
      subjectId: assignment.subjectId,
      termId: term?.id ?? null,
      dueDate: asIsoDate(assignment.dueDate),
      collection: {
        assignmentId: assignment.id,
        totalMarks: collection.totalMarks,
        accepting: collection.accepting,
        markingGuide: collection.markingGuide,
      },
      questions,
      questionsEditable: submissions.length === 0,
      aiDrafting: await this.feedback.available(db, assignment.schoolId),
      roster,
      counts: {
        submitted: roster.filter((r) => r.status === "SUBMITTED").length,
        marked: roster.filter((r) => r.status === "MARKED").length,
        released: roster.filter((r) => r.released).length,
        notSubmitted: roster.filter((r) => r.status === "NOT_SUBMITTED").length,
      },
    };
  }

  private async readStudentWork(db: Db, assignmentId: string, studentId: string): Promise<StudentWorkDto> {
    const collection = await this.collectionOf(db, assignmentId);
    const student = await db.student.findUnique({ where: { id: studentId }, select: { firstName: true, lastName: true } });
    if (!student) throw new NotFoundError("That student could not be found.");
    const rows = await db.assignmentSubmission.findMany({
      where: { collectionId: collection.id, studentId },
      orderBy: { attempt: "desc" },
      include: { files: { orderBy: { createdAt: "asc" } }, feedbackDraft: true },
    });
    const markers = await db.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.markedBy).filter((v): v is string => !!v))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const markerName = new Map(markers.map((u) => [u.id, fullName(u)]));
    const questions = await this.questionsOf(db, collection.id);
    return {
      assignmentId,
      studentId,
      studentName: fullName(student),
      totalMarks: collection.totalMarks,
      questions,
      attempts: rows.map(
        (r): AssignmentSubmissionDto => ({
          id: r.id,
          studentId: r.studentId,
          attempt: r.attempt,
          body: r.body,
          files: r.files.map(fileDto),
          submittedAt: r.submittedAt,
          late: r.late,
          answers: answerResults(questions, answersOf(r.answers), true),
          autoMark: r.autoMark,
          feedbackAiDrafted: r.feedbackAiDrafted,
          draft: r.feedbackDraft
            ? {
                status: r.feedbackDraft.status,
                mark: r.feedbackDraft.mark,
                feedback: r.feedbackDraft.feedback,
                reason: r.feedbackDraft.reason,
                failure: r.feedbackDraft.failure,
                createdAt: r.feedbackDraft.createdAt,
              }
            : null,
          pastedPercent: pastedPercent(r.typedChars, r.pastedChars),
          mark: r.mark,
          feedback: r.feedback,
          markedByName: r.markedBy ? (markerName.get(r.markedBy) ?? null) : null,
          markedAt: r.markedAt,
          releasedAt: r.releasedAt,
          returnedAt: r.returnedAt,
          returnNote: r.returnNote,
        }),
      ),
    };
  }

  private async readMine(
    db: Db,
    assignment: AssignmentRow,
    collection: { id: string; totalMarks: number; accepting: boolean },
    studentId: string,
  ): Promise<MyAssignmentDto> {
    const [subject, rows, staged] = await Promise.all([
      db.subject.findUnique({ where: { id: assignment.subjectId }, select: { name: true } }),
      db.assignmentSubmission.findMany({
        where: { collectionId: collection.id, studentId },
        orderBy: { attempt: "desc" },
        include: { files: { orderBy: { createdAt: "asc" } } },
      }),
      db.assignmentSubmissionFile.findMany({
        where: { collectionId: collection.id, studentId, submissionId: null },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const status = statusOf(rows[0] ?? null);
    const questions = await this.questionsOf(db, collection.id);
    return {
      assignmentId: assignment.id,
      title: assignment.title,
      instructions: assignment.instructions,
      subjectName: subject?.name ?? "",
      dueDate: asIsoDate(assignment.dueDate),
      totalMarks: collection.totalMarks,
      accepting: collection.accepting,
      status,
      canSubmit: status === "RETURNED" || (status === "NOT_SUBMITTED" && collection.accepting),
      stagedFiles: staged.map(fileDto),
      // Never the right answers.
      questions: questions.map((q) => ({
        id: q.id,
        number: q.number,
        type: q.type,
        text: q.text,
        marks: q.marks,
        options: q.options,
      })),
      // No paste counts here, and nothing marked until it is released. Which
      // answers were right shows with the mark, never before.
      attempts: rows.map((r) => ({
        attempt: r.attempt,
        body: r.body,
        files: r.files.map(fileDto),
        answers: answerResults(questions, answersOf(r.answers), r.releasedAt !== null),
        submittedAt: r.submittedAt,
        late: r.late,
        mark: r.releasedAt ? r.mark : null,
        feedback: r.releasedAt ? r.feedback : null,
        returnNote: r.returnNote,
      })),
    };
  }

  /** The list a student or a parent sees. No answer text and no paste counts. */
  private async familyList(db: Db, studentId: string): Promise<FamilyAssignmentListResponse> {
    const armId = await this.studentArm(db, studentId);
    if (!armId) return { data: [] };
    const today = lagosTodayIso();
    const assignments = await db.assignment.findMany({
      where: {
        classArmId: armId,
        withdrawnAt: null,
        collection: { isNot: null },
        dueDate: {
          gte: new Date(`${addDaysIso(today, -FAMILY_LOOKBACK_DAYS)}T00:00:00.000Z`),
          lte: new Date(`${addDaysIso(today, FAMILY_LOOKAHEAD_DAYS)}T00:00:00.000Z`),
        },
      },
      include: { collection: true },
      orderBy: [{ dueDate: "desc" }, { postedAt: "desc" }],
    });
    if (assignments.length === 0) return { data: [] };
    const [subjects, rows] = await Promise.all([
      db.subject.findMany({
        where: { id: { in: [...new Set(assignments.map((a) => a.subjectId))] } },
        select: { id: true, name: true },
      }),
      db.assignmentSubmission.findMany({
        where: { studentId, collectionId: { in: assignments.map((a) => a.collection!.id) } },
        orderBy: { attempt: "desc" },
        include: { files: { orderBy: { createdAt: "asc" } } },
      }),
    ]);
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
    const latestBy = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latestBy.has(r.collectionId)) latestBy.set(r.collectionId, r);
    return {
      data: assignments.map((a): FamilyAssignmentDto => {
        const latest = latestBy.get(a.collection!.id) ?? null;
        const released = latest?.releasedAt != null;
        return {
          assignmentId: a.id,
          title: a.title,
          subjectName: subjectName.get(a.subjectId) ?? "",
          dueDate: asIsoDate(a.dueDate),
          totalMarks: a.collection!.totalMarks,
          status: statusOf(latest),
          late: latest?.late ?? false,
          submittedAt: latest?.submittedAt ?? null,
          mark: released ? latest!.mark : null,
          feedback: released ? latest!.feedback : null,
          returnNote: latest?.returnNote ?? null,
          files: latest ? latest.files.map(fileDto) : [],
        };
      }),
    };
  }

  private async isAdmin(authCtx: AuthContext): Promise<boolean> {
    const roles = await getActiveUserRoleKeys(authCtx);
    return roles.includes("owner") || roles.includes("admin");
  }
}
