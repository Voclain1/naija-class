import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  ValidationError,
  findScoreError,
  resolveLetterGrade,
  sumComponentScores,
  type AssessmentDto,
  type AssessmentFeedQuery,
  type AssessmentFeedResponse,
  type AssessmentScoreDto,
  type AssessmentWithScoresDto,
  type CreateAssessmentScoreInput,
  type UpdateAssessmentScoreInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { getTeacherScope } from "../teacher-scope/teacher-scope.helper";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Audit-action naming — singular resource, dotted verb (locked in slice 1).
const AUDIT = {
  scoreCreate: "assessment-score.create",
  scoreUpdate: "assessment-score.update",
} as const;

// The tenant-scoped Prisma handle (the `db` passed into withTenant's callback).
type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

@Injectable()
export class AssessmentService {
  // =========================================================================
  // POST /assessment-scores — enter/correct one component's mark, then
  // materialize the summary in the SAME tx (Q1a: score + summary never diverge).
  // =========================================================================
  async createScore(
    authCtx: AuthContext,
    input: CreateAssessmentScoreInput,
    reqCtx: RequestContext,
  ): Promise<AssessmentWithScoresDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scoped = this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId));

      // a) component (RLS-scoped) → live weight is the strict ceiling.
      const weight = await this.requireComponentWeight(db, authCtx.schoolId, input.componentId);
      // b) strict 0..weight against the live component.
      this.assertScore(input.score, weight);
      // c) the student's enrollment for the term → classArmId + academicYearId.
      const enrollment = await this.requireEnrollment(db, authCtx.schoolId, input.studentId, input.termId);
      // d) teacher scope (admins/owners skip).
      if (scoped) {
        await this.assertSubjectInScope(
          db,
          authCtx.userId,
          enrollment.classArmId,
          input.subjectId,
          enrollment.academicYearId,
        );
      }

      // e) upsert the score on its unique key.
      const saved = await db.assessmentScore.upsert({
        where: {
          schoolId_studentId_subjectId_termId_componentId: {
            schoolId: authCtx.schoolId,
            studentId: input.studentId,
            subjectId: input.subjectId,
            termId: input.termId,
            componentId: input.componentId,
          },
        },
        create: {
          schoolId: authCtx.schoolId,
          studentId: input.studentId,
          subjectId: input.subjectId,
          termId: input.termId,
          componentId: input.componentId,
          score: input.score,
          enteredBy: authCtx.userId,
        },
        update: { score: input.score, enteredBy: authCtx.userId, enteredAt: new Date() },
        select: SCORE_SELECT,
      });

      // f) materialize the summary (same tx — a throw here rolls back the score).
      const { assessment, clearedSignOff } = await this.materializeSummary(db, authCtx.schoolId, {
        studentId: input.studentId,
        subjectId: input.subjectId,
        termId: input.termId,
        classArmId: enrollment.classArmId,
        academicYearId: enrollment.academicYearId,
      });

      // h) audit (one row; the implicit sign-off unlock rides as metadata).
      await this.writeAudit(db, authCtx, reqCtx, AUDIT.scoreCreate, saved.id, {
        studentId: input.studentId,
        subjectId: input.subjectId,
        termId: input.termId,
        componentId: input.componentId,
        ...(clearedSignOff ? { clearedSignOff: true } : {}),
      });

      // i) return the materialized summary + the full component breakdown.
      return this.composeResult(db, assessment, input.studentId, input.subjectId, input.termId);
    });
  }

  // =========================================================================
  // PATCH /assessment-scores/:id — correct one score, re-materialize.
  // =========================================================================
  async updateScore(
    authCtx: AuthContext,
    id: string,
    input: UpdateAssessmentScoreInput,
    reqCtx: RequestContext,
  ): Promise<AssessmentWithScoresDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scoped = this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId));

      const existing = await db.assessmentScore.findUnique({
        where: { id },
        select: { id: true, studentId: true, subjectId: true, termId: true, componentId: true },
      });
      if (!existing) throw new NotFoundError("Assessment score not found.");

      const weight = await this.requireComponentWeight(db, authCtx.schoolId, existing.componentId);
      this.assertScore(input.score, weight);
      const enrollment = await this.requireEnrollment(db, authCtx.schoolId, existing.studentId, existing.termId);
      if (scoped) {
        await this.assertSubjectInScope(
          db,
          authCtx.userId,
          enrollment.classArmId,
          existing.subjectId,
          enrollment.academicYearId,
        );
      }

      const saved = await db.assessmentScore.update({
        where: { id },
        data: { score: input.score, enteredBy: authCtx.userId, enteredAt: new Date() },
        select: SCORE_SELECT,
      });

      const { assessment, clearedSignOff } = await this.materializeSummary(db, authCtx.schoolId, {
        studentId: existing.studentId,
        subjectId: existing.subjectId,
        termId: existing.termId,
        classArmId: enrollment.classArmId,
        academicYearId: enrollment.academicYearId,
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.scoreUpdate, saved.id, {
        studentId: existing.studentId,
        subjectId: existing.subjectId,
        termId: existing.termId,
        componentId: existing.componentId,
        ...(clearedSignOff ? { clearedSignOff: true } : {}),
      });

      return this.composeResult(db, assessment, existing.studentId, existing.subjectId, existing.termId);
    });
  }

  // =========================================================================
  // GET /assessments/:id — one summary + component breakdown.
  // =========================================================================
  async getById(authCtx: AuthContext, id: string): Promise<AssessmentWithScoresDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.assessment.findUnique({ where: { id }, select: ASSESSMENT_SELECT });
      if (!row) throw new NotFoundError("Assessment not found.");

      if (this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId))) {
        await this.assertSubjectInScope(
          db,
          authCtx.userId,
          row.classArmId,
          row.subjectId,
          row.academicYearId,
        );
      }

      return this.composeResult(db, toAssessmentDto(row), row.studentId, row.subjectId, row.termId);
    });
  }

  // =========================================================================
  // GET /assessments?termId=&classArmId=&subjectId= — gradebook column feed.
  // =========================================================================
  async getFeed(authCtx: AuthContext, query: AssessmentFeedQuery): Promise<AssessmentFeedResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      if (this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId))) {
        const term = await db.term.findUnique({
          where: { id: query.termId },
          select: { academicYearId: true },
        });
        await this.assertSubjectInScope(
          db,
          authCtx.userId,
          query.classArmId,
          query.subjectId,
          term?.academicYearId,
        );
      }

      const enrollments = await db.enrollment.findMany({
        where: { termId: query.termId, classArmId: query.classArmId },
        select: { student: { select: FEED_STUDENT_SELECT } },
      });
      const studentIds = enrollments.map((e) => e.student.id);

      const [assessments, scores] = await Promise.all([
        db.assessment.findMany({
          where: { termId: query.termId, subjectId: query.subjectId, studentId: { in: studentIds } },
          select: ASSESSMENT_SELECT,
        }),
        db.assessmentScore.findMany({
          where: { termId: query.termId, subjectId: query.subjectId, studentId: { in: studentIds } },
          select: SCORE_SELECT,
        }),
      ]);

      const assessmentByStudent = new Map(assessments.map((a) => [a.studentId, a]));
      const scoresByStudent = new Map<string, typeof scores>();
      for (const s of scores) {
        const list = scoresByStudent.get(s.studentId) ?? [];
        list.push(s);
        scoresByStudent.set(s.studentId, list);
      }

      const rows = enrollments
        .map((e) => e.student)
        .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName))
        .map((student) => {
          const a = assessmentByStudent.get(student.id);
          return {
            student: {
              id: student.id,
              admissionNumber: student.admissionNumber,
              firstName: student.firstName,
              middleName: student.middleName,
              lastName: student.lastName,
            },
            assessment: a ? toAssessmentDto(a) : null,
            scores: (scoresByStudent.get(student.id) ?? []).map(toScoreDto),
          };
        });

      return { data: rows };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  private async resolveRoleKeys(db: TenantDb, userId: string): Promise<string[]> {
    const grants = await db.userRole.findMany({
      where: { userId },
      select: { role: { select: { key: true } } },
    });
    return grants.map((g) => g.role.key);
  }

  // A teacher who is NOT also an owner/admin is scope-restricted; owners/admins
  // are unscoped overrides (Phase 1 roster precedent — enteredBy captures the
  // override in audit).
  private isTeacherScoped(roleKeys: string[]): boolean {
    const privileged = roleKeys.includes("owner") || roleKeys.includes("admin");
    return !privileged && roleKeys.includes("teacher");
  }

  private async requireComponentWeight(
    db: TenantDb,
    schoolId: string,
    componentId: string,
  ): Promise<number> {
    const component = await db.gradingComponent.findUnique({
      where: { id: componentId },
      select: { schoolId: true, weight: true },
    });
    // RLS already scopes the lookup to this school (a cross-tenant id returns
    // null); the schoolId assert is the documented belt-and-braces second line.
    if (!component || component.schoolId !== schoolId) {
      throw new ValidationError("Unknown grading component.", {
        issues: [{ path: "componentId", code: "unknown_component", message: "Unknown grading component." }],
      });
    }
    return component.weight;
  }

  private assertScore(score: number, weight: number): void {
    const error = findScoreError(score, weight);
    if (error) {
      throw new ValidationError(error, {
        issues: [{ path: "score", code: "score_range", message: error }],
      });
    }
  }

  private async requireEnrollment(
    db: TenantDb,
    schoolId: string,
    studentId: string,
    termId: string,
  ): Promise<{ classArmId: string; academicYearId: string }> {
    const enrollment = await db.enrollment.findUnique({
      where: { schoolId_studentId_termId: { schoolId, studentId, termId } },
      select: { classArmId: true, academicYearId: true },
    });
    if (!enrollment) {
      throw new ValidationError("Student is not enrolled this term.", {
        issues: [{ path: "studentId", code: "not_enrolled", message: "Student is not enrolled this term." }],
      });
    }
    return enrollment;
  }

  // Teacher-scope authorization: the subject must be one the teacher teaches in
  // the arm where the student is enrolled this term. Out-of-scope → 404 (the
  // resource appears not to exist; matches the teacher-roster 404 posture).
  private async assertSubjectInScope(
    db: TenantDb,
    teacherId: string,
    classArmId: string,
    subjectId: string,
    academicYearId?: string,
  ): Promise<void> {
    const scope = await getTeacherScope(db, teacherId, academicYearId);
    const subjects = scope.subjectsByArm.get(classArmId) ?? [];
    if (!subjects.some((s) => s.id === subjectId)) {
      throw new NotFoundError("This class or subject is not in your assigned scope.");
    }
  }

  // Materialize the denormalized summary from the raw scores. Runs inside the
  // caller's tx, so a throw here rolls the whole score write back. Returns
  // whether an existing sign-off was cleared (the implicit unlock).
  private async materializeSummary(
    db: TenantDb,
    schoolId: string,
    params: {
      studentId: string;
      subjectId: string;
      termId: string;
      classArmId: string;
      academicYearId: string;
    },
  ): Promise<{ assessment: AssessmentDto; clearedSignOff: boolean }> {
    const { studentId, subjectId, termId, classArmId, academicYearId } = params;

    const scores = await db.assessmentScore.findMany({
      where: { studentId, subjectId, termId },
      select: { score: true },
    });
    const totalScore = sumComponentScores(scores.map((s) => s.score));

    const boundaries = await db.gradeBoundary.findMany({
      select: { letter: true, minScore: true, maxScore: true, remark: true },
    });
    const letterGrade = resolveLetterGrade(totalScore, boundaries);
    const remark = letterGrade
      ? boundaries.find((b) => b.letter === letterGrade)?.remark ?? null
      : null;

    const existing = await db.assessment.findUnique({
      where: { schoolId_studentId_subjectId_termId: { schoolId, studentId, subjectId, termId } },
      select: { subjectSignedOffAt: true },
    });
    const clearedSignOff = Boolean(existing?.subjectSignedOffAt);

    const assessment = await db.assessment.upsert({
      where: { schoolId_studentId_subjectId_termId: { schoolId, studentId, subjectId, termId } },
      create: {
        schoolId,
        studentId,
        subjectId,
        termId,
        academicYearId,
        classArmId,
        totalScore,
        letterGrade,
        remark,
        computedAt: new Date(),
      },
      update: {
        totalScore,
        letterGrade,
        remark,
        classArmId,
        academicYearId,
        computedAt: new Date(),
        // The implicit unlock (Q6): any score change clears a prior sign-off.
        // Positions are deliberately untouched — slice 4 owns them.
        subjectSignedOffAt: null,
        subjectSignedOffBy: null,
      },
      select: ASSESSMENT_SELECT,
    });

    return { assessment: toAssessmentDto(assessment), clearedSignOff };
  }

  // Compose the (summary + component breakdown) response from the current rows.
  private async composeResult(
    db: TenantDb,
    assessment: AssessmentDto,
    studentId: string,
    subjectId: string,
    termId: string,
  ): Promise<AssessmentWithScoresDto> {
    const scores = await db.assessmentScore.findMany({
      where: { studentId, subjectId, termId },
      select: SCORE_SELECT,
      orderBy: { enteredAt: "asc" },
    });
    return { assessment, scores: scores.map(toScoreDto) };
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    action: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType: "assessment_score",
        entityId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}

// -------------------------------------------------------------------------
// Selects + mappers
// -------------------------------------------------------------------------

const SCORE_SELECT = {
  id: true,
  studentId: true,
  subjectId: true,
  termId: true,
  componentId: true,
  score: true,
  enteredBy: true,
  enteredAt: true,
  updatedAt: true,
} satisfies Prisma.AssessmentScoreSelect;

const ASSESSMENT_SELECT = {
  id: true,
  studentId: true,
  subjectId: true,
  termId: true,
  academicYearId: true,
  classArmId: true,
  totalScore: true,
  letterGrade: true,
  remark: true,
  subjectPosition: true,
  classPosition: true,
  subjectComment: true,
  subjectSignedOffAt: true,
  subjectSignedOffBy: true,
  computedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssessmentSelect;

const FEED_STUDENT_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
} satisfies Prisma.StudentSelect;

type ScoreRow = Prisma.AssessmentScoreGetPayload<{ select: typeof SCORE_SELECT }>;
type AssessmentRow = Prisma.AssessmentGetPayload<{ select: typeof ASSESSMENT_SELECT }>;

function toScoreDto(row: ScoreRow): AssessmentScoreDto {
  return {
    id: row.id,
    studentId: row.studentId,
    subjectId: row.subjectId,
    termId: row.termId,
    componentId: row.componentId,
    score: row.score,
    enteredBy: row.enteredBy,
    enteredAt: row.enteredAt,
    updatedAt: row.updatedAt,
  };
}

function toAssessmentDto(row: AssessmentRow): AssessmentDto {
  return {
    id: row.id,
    studentId: row.studentId,
    subjectId: row.subjectId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    classArmId: row.classArmId,
    totalScore: row.totalScore,
    letterGrade: row.letterGrade,
    remark: row.remark,
    subjectPosition: row.subjectPosition,
    classPosition: row.classPosition,
    subjectComment: row.subjectComment,
    subjectSignedOffAt: row.subjectSignedOffAt,
    subjectSignedOffBy: row.subjectSignedOffBy,
    computedAt: row.computedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
