import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CbtResultRowDto,
  type CbtResultsDto,
  type SaveCbtTheoryMarksInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import type { RequestMeta } from "../question-bank/question-bank.service.js";
import { attemptFlags, countingAttempt, minutesTaken, objectiveScore, resultTotal, type MarkingKey } from "./cbt-marking.js";
import { CbtSittingsService, isDeliverable, paperFigures, type Db, type SittingRow } from "./cbt-sittings.service.js";

// ---------------------------------------------------------------------------
// Online exams (CBT3) — results (docs/modules/cbt.md D4, D5, D6, D8).
//
// Marking happens here, on every read, against the frozen paper's key: the
// key never left the server (D4), and a FINAL paper cannot change, so the
// score cannot drift. What the teacher decides is stored: the theory mark
// from the paper scripts, and which computer counts for a student who used
// more than one. Nothing here writes to the gradebook — "Send to gradebook"
// goes through the CP5a preview-then-save path, by the teacher (D8).
//
// Same scope as the sittings themselves (D62): an out-of-scope sitting is a
// 404. Reading needs cbt.read; changing needs cbt.manage (the controller).
// ---------------------------------------------------------------------------

const AUDIT = {
  theoryMarks: "cbt-result.theory-marks",
  chooseAttempt: "cbt-result.choose-attempt",
} as const;

@Injectable()
export class CbtResultsService {
  constructor(private readonly sittings: CbtSittingsService) {}

  async results(authCtx: AuthContext, id: string): Promise<CbtResultsDto> {
    const scope = await this.sittings.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => this.build(db, await this.published(db, scope, id)));
  }

  async saveTheoryMarks(authCtx: AuthContext, id: string, input: SaveCbtTheoryMarksInput, meta: RequestMeta): Promise<CbtResultsDto> {
    const scope = await this.sittings.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.published(db, scope, id);
      const { onPaperTotal } = paperFigures(row.paper);
      const candidates = new Map(
        (await db.cbtCandidate.findMany({ where: { sittingId: id }, select: { id: true, studentId: true } })).map((c) => [c.studentId, c.id]),
      );
      for (const m of input.marks) {
        if (!candidates.has(m.studentId)) throw new ValidationError("A student in this list is not on this exam's register.");
        if (m.theoryMark !== null && onPaperTotal === 0) {
          throw new ValidationError("This paper has no questions sat on paper, so it has no theory mark.");
        }
        if (m.theoryMark !== null && m.theoryMark > onPaperTotal) {
          throw new ValidationError(`A theory mark can be at most ${onPaperTotal}, the marks for the questions sat on paper.`);
        }
      }
      for (const m of input.marks) {
        await db.cbtCandidate.update({ where: { id: candidates.get(m.studentId)! }, data: { theoryMark: m.theoryMark } });
      }
      await this.audit(db, authCtx, AUDIT.theoryMarks, id, meta, { count: input.marks.length });
      return this.build(db, row);
    });
  }

  /** Makes this attempt the one that counts for its student (D5). */
  async chooseAttempt(authCtx: AuthContext, id: string, attemptId: string, meta: RequestMeta): Promise<CbtResultsDto> {
    const scope = await this.sittings.resolveScope(authCtx);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await this.published(db, scope, id);
      const attempt = await db.cbtAttempt.findFirst({ where: { id: attemptId, sittingId: id }, select: { id: true, candidateId: true } });
      if (!attempt) throw new NotFoundError("That attempt could not be found on this exam.");
      // Clear first: the partial unique index allows one chosen per student.
      await db.cbtAttempt.updateMany({ where: { candidateId: attempt.candidateId, chosen: true }, data: { chosen: false } });
      await db.cbtAttempt.update({ where: { id: attempt.id }, data: { chosen: true } });
      await this.audit(db, authCtx, AUDIT.chooseAttempt, id, meta, { attemptId });
      return this.build(db, row);
    });
  }

  // -------------------------------------------------------------------------

  private async published(db: Db, scope: Awaited<ReturnType<CbtSittingsService["resolveScope"]>>, id: string): Promise<SittingRow> {
    const row = await this.sittings.load(db, scope, id);
    if (row.status === "DRAFT") {
      throw new ConflictError("SITTING_NOT_PUBLISHED", "There are no results until the online exam is published and sat.");
    }
    return row;
  }

  private async build(db: Db, row: SittingRow): Promise<CbtResultsDto> {
    const figures = paperFigures(row.paper);
    const key: MarkingKey = new Map(
      row.paper.sections
        .flatMap((s) => s.items)
        .filter(isDeliverable)
        .map((item) => [item.id, { correctOptionId: item.question.options.find((o) => o.isCorrect)!.id, marks: item.question.marks }]),
    );
    const sitting = { windowEndsAt: row.windowEndsAt, durationMinutes: row.durationMinutes, closedAt: row.closedAt };

    const candidates = await db.cbtCandidate.findMany({
      where: { sittingId: row.id },
      include: {
        student: { select: { admissionNumber: true, firstName: true, lastName: true } },
        classArm: { select: { name: true } },
        attempts: { orderBy: [{ firstReceivedAt: "asc" }, { id: "asc" }] },
      },
    });

    const rows: CbtResultRowDto[] = candidates.map((c) => {
      const attempts = c.attempts.map((a, i) => ({
        id: a.id,
        computerLabel: `Computer ${i + 1}`,
        answeredCount: a.answeredCount,
        objectiveScore: objectiveScore(key, a.answers as Record<string, string>),
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt?.toISOString() ?? null,
        lastReceivedAt: a.lastReceivedAt.toISOString(),
        minutesTaken: minutesTaken(a),
        extraMinutes: a.extraMinutes,
        focusLosses: a.focusLosses,
        flags: attemptFlags(a, sitting),
        chosen: a.chosen,
      }));
      const { attempt, needsChoice } = countingAttempt(attempts);
      const objective = attempt?.objectiveScore ?? null;
      return {
        studentId: c.studentId,
        admissionNumber: c.student.admissionNumber,
        firstName: c.student.firstName,
        lastName: c.student.lastName,
        armName: c.classArm.name,
        version: c.version,
        attempts,
        countingAttemptId: attempt?.id ?? null,
        needsChoice,
        objectiveScore: objective,
        theoryMark: c.theoryMark,
        total: resultTotal(objective, c.theoryMark, figures.onPaperTotal),
      };
    });
    rows.sort((a, b) => a.armName.localeCompare(b.armName) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

    return {
      sittingId: row.id,
      title: row.title,
      status: row.status,
      closedAt: row.closedAt?.toISOString() ?? null,
      questionCount: figures.objectiveQuestionCount,
      objectiveTotal: figures.objectiveTotal,
      onPaperTotal: figures.onPaperTotal,
      paperTotal: figures.paperTotal,
      termId: row.paper.termId,
      subjectId: row.paper.subjectId,
      componentId: row.paper.componentId,
      rows,
    };
  }

  private async audit(db: Db, authCtx: AuthContext, action: string, entityId: string, meta: RequestMeta, metadata: Record<string, unknown>) {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "cbt-sitting",
        entityId,
        ipAddress: meta.ipAddress ?? null,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}
