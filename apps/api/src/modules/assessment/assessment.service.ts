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
  type BulkAssessmentScoreInput,
  type CreateAssessmentScoreInput,
  type SignOffBulkInput,
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
  signOff: "assessment.sign-off",
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
      await this.writeAudit(db, authCtx, reqCtx, AUDIT.scoreCreate, "assessment_score", saved.id, {
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

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.scoreUpdate, "assessment_score", saved.id, {
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

      return this.buildColumnFeed(db, query);
    });
  }

  // =========================================================================
  // POST /assessment-scores/bulk — one gradebook column save. ATOMIC
  // all-or-nothing (Q2a): pre-validate every row, then upsert all + materialize
  // one summary per distinct student in a single tx. Unlike the Phase-1 CSV
  // import (deliberately per-row, partial-success), this is one interactive
  // edit — any failure rolls the whole batch back.
  // =========================================================================
  async bulkUpsertScores(
    authCtx: AuthContext,
    input: BulkAssessmentScoreInput,
    reqCtx: RequestContext,
  ): Promise<AssessmentFeedResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scoped = this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId));

      // b) term once → academicYearId for the scope check.
      const term = await db.term.findUnique({
        where: { id: input.termId },
        select: { academicYearId: true },
      });
      if (!term) {
        throw new ValidationError("Unknown term.", {
          issues: [{ path: ["termId"], code: "unknown_term", message: "Unknown term." }],
        });
      }

      // c) components: a column save spans several components (CA1/CA2/Exam) —
      // resolve every referenced one ONCE; RLS scopes the lookup to this school.
      const componentIds = [...new Set(input.rows.map((r) => r.componentId))];
      const components = await db.gradingComponent.findMany({
        where: { id: { in: componentIds } },
        select: { id: true, weight: true },
      });
      const weightById = new Map(components.map((c) => [c.id, c.weight]));

      // d) strict 0..weight across ALL rows up front — collect every issue, bind
      // to the offending row. No writes attempted until all rows are valid.
      const scoreIssues: Array<{ path: (string | number)[]; code: string; message: string }> = [];
      input.rows.forEach((r, i) => {
        const weight = weightById.get(r.componentId);
        if (weight === undefined) {
          scoreIssues.push({
            path: ["rows", i, "componentId"],
            code: "unknown_component",
            message: "Unknown grading component.",
          });
          return;
        }
        const error = findScoreError(r.score, weight);
        if (error) {
          scoreIssues.push({ path: ["rows", i, "score"], code: "score_range", message: error });
        }
      });
      if (scoreIssues.length > 0) {
        throw new ValidationError("One or more scores are invalid.", { issues: scoreIssues });
      }

      // e) enrollments for ALL students in one query → classArmId + academicYearId.
      const studentIds = [...new Set(input.rows.map((r) => r.studentId))];
      const enrollByStudent = await this.loadEnrollmentsForTerm(db, input.termId, studentIds);

      const enrollIssues: Array<{ path: (string | number)[]; code: string; message: string }> = [];
      input.rows.forEach((r, i) => {
        if (!enrollByStudent.has(r.studentId)) {
          enrollIssues.push({
            path: ["rows", i, "studentId"],
            code: "not_enrolled",
            message: "Student is not enrolled this term.",
          });
        }
      });
      if (enrollIssues.length > 0) {
        throw new ValidationError("One or more students are not enrolled this term.", {
          issues: enrollIssues,
        });
      }

      // e') bulk teacher-scope pre-check (Q3b): one getTeacherScope call total.
      if (scoped) {
        const scope = await this.loadTeacherScope(db, authCtx.userId, term.academicYearId);
        const scopeIssues: Array<{ path: (string | number)[]; code: string; message: string }> = [];
        input.rows.forEach((r, i) => {
          const arm = enrollByStudent.get(r.studentId)!.classArmId;
          const subjects = scope.subjectsByArm.get(arm) ?? [];
          if (!subjects.some((s) => s.id === input.subjectId)) {
            scopeIssues.push({
              path: ["rows", i],
              code: "out_of_scope",
              message: "This class or subject is not in your assigned scope.",
            });
          }
        });
        if (scopeIssues.length > 0) {
          throw new NotFoundError("This class or subject is not in your assigned scope.", {
            issues: scopeIssues,
          });
        }
      }

      // f) all validation passed — atomic write of every row.
      for (const r of input.rows) {
        await db.assessmentScore.upsert({
          where: {
            schoolId_studentId_subjectId_termId_componentId: {
              schoolId: authCtx.schoolId,
              studentId: r.studentId,
              subjectId: input.subjectId,
              termId: input.termId,
              componentId: r.componentId,
            },
          },
          create: {
            schoolId: authCtx.schoolId,
            studentId: r.studentId,
            subjectId: input.subjectId,
            termId: input.termId,
            componentId: r.componentId,
            score: r.score,
            enteredBy: authCtx.userId,
          },
          update: { score: r.score, enteredBy: authCtx.userId, enteredAt: new Date() },
          select: { id: true },
        });
      }

      // materialize ONE summary per distinct student (not per row).
      let clearedSignOffCount = 0;
      for (const studentId of studentIds) {
        const enrollment = enrollByStudent.get(studentId)!;
        const { clearedSignOff } = await this.materializeSummary(db, authCtx.schoolId, {
          studentId,
          subjectId: input.subjectId,
          termId: input.termId,
          classArmId: enrollment.classArmId,
          academicYearId: enrollment.academicYearId,
        });
        if (clearedSignOff) clearedSignOffCount += 1;
      }

      // g) single audit row (Phase-1 bulk convention).
      const classArmIds = [...new Set([...enrollByStudent.values()].map((e) => e.classArmId))];
      await this.writeAudit(db, authCtx, reqCtx, AUDIT.scoreCreate, "assessment_score", input.termId, {
        bulk: true,
        termId: input.termId,
        subjectId: input.subjectId,
        classArmId: classArmIds[0] ?? null,
        count: input.rows.length,
        clearedSignOffCount,
      });

      // h) return the refreshed column feed (one arm — a column is one arm).
      return this.buildColumnFeed(db, {
        termId: input.termId,
        classArmId: classArmIds[0]!,
        subjectId: input.subjectId,
      });
    });
  }

  // =========================================================================
  // POST /assessments/:id/sign-off — subject teacher signs off one
  // (student × subject). Requires the column fully scored.
  // =========================================================================
  async signOff(
    authCtx: AuthContext,
    id: string,
    reqCtx: RequestContext,
  ): Promise<AssessmentDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scoped = this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId));

      const row = await db.assessment.findUnique({
        where: { id },
        select: {
          id: true,
          studentId: true,
          subjectId: true,
          termId: true,
          classArmId: true,
          academicYearId: true,
        },
      });
      if (!row) throw new NotFoundError("Assessment not found.");

      if (scoped) {
        await this.assertSubjectInScope(db, authCtx.userId, row.classArmId, row.subjectId, row.academicYearId);
      }

      await this.assertColumnFullyScored(db, row.studentId, row.subjectId, row.termId);

      const updated = await db.assessment.update({
        where: { id },
        data: { subjectSignedOffAt: new Date(), subjectSignedOffBy: authCtx.userId },
        select: ASSESSMENT_SELECT,
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.signOff, "assessment", id, {
        studentId: row.studentId,
        subjectId: row.subjectId,
        termId: row.termId,
      });

      return toAssessmentDto(updated);
    });
  }

  // =========================================================================
  // POST /assessments/sign-off/bulk — sign off a whole column at once.
  // =========================================================================
  async signOffColumn(
    authCtx: AuthContext,
    input: SignOffBulkInput,
    reqCtx: RequestContext,
  ): Promise<AssessmentDto[]> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const scoped = this.isTeacherScoped(await this.resolveRoleKeys(db, authCtx.userId));

      if (scoped) {
        const term = await db.term.findUnique({
          where: { id: input.termId },
          select: { academicYearId: true },
        });
        await this.assertSubjectInScope(
          db,
          authCtx.userId,
          input.classArmId,
          input.subjectId,
          term?.academicYearId,
        );
      }

      const enrollments = await db.enrollment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId },
        select: { studentId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);

      // Every enrolled student's column must be fully scored before sign-off.
      const componentIds = (
        await db.gradingComponent.findMany({ select: { id: true } })
      ).map((c) => c.id);
      const scores = await db.assessmentScore.findMany({
        where: { termId: input.termId, subjectId: input.subjectId, studentId: { in: studentIds } },
        select: { studentId: true, componentId: true },
      });
      const scoredByStudent = new Map<string, Set<string>>();
      for (const s of scores) {
        const set = scoredByStudent.get(s.studentId) ?? new Set<string>();
        set.add(s.componentId);
        scoredByStudent.set(s.studentId, set);
      }

      const issues: Array<{ path: (string | number)[]; code: string; message: string }> = [];
      for (const studentId of studentIds) {
        const scored = scoredByStudent.get(studentId) ?? new Set<string>();
        for (const componentId of componentIds) {
          if (!scored.has(componentId)) {
            issues.push({
              path: ["students", studentId, "componentId"],
              code: "missing_component",
              message: "All components must be scored before sign-off.",
            });
          }
        }
      }
      if (issues.length > 0) {
        throw new ValidationError("All students must be fully scored before sign-off.", { issues });
      }

      const now = new Date();
      await db.assessment.updateMany({
        where: { termId: input.termId, classArmId: input.classArmId, subjectId: input.subjectId },
        data: { subjectSignedOffAt: now, subjectSignedOffBy: authCtx.userId },
      });

      const updated = await db.assessment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId, subjectId: input.subjectId },
        select: ASSESSMENT_SELECT,
      });

      await this.writeAudit(db, authCtx, reqCtx, AUDIT.signOff, "assessment", input.classArmId, {
        bulk: true,
        termId: input.termId,
        classArmId: input.classArmId,
        subjectId: input.subjectId,
        count: updated.length,
      });

      return updated.map(toAssessmentDto);
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  // Build the (arm × subject × term) gradebook column: one row per enrolled
  // student with their summary + per-component scores. Shared by GET /assessments
  // and the bulk score save's response. No N+1: one enrollment query + one
  // assessment query + one score query.
  private async buildColumnFeed(
    db: TenantDb,
    query: { termId: string; classArmId: string; subjectId: string },
  ): Promise<AssessmentFeedResponse> {
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
  }

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

  // Thin seams the bulk path uses ONCE each — extracted so the N+1-prevention
  // test can spy and assert exactly one call regardless of batch size.
  private async loadTeacherScope(db: TenantDb, userId: string, academicYearId?: string) {
    return getTeacherScope(db, userId, academicYearId);
  }

  private async loadEnrollmentsForTerm(
    db: TenantDb,
    termId: string,
    studentIds: string[],
  ): Promise<Map<string, { classArmId: string; academicYearId: string }>> {
    const enrollments = await db.enrollment.findMany({
      where: { termId, studentId: { in: studentIds } },
      select: { studentId: true, classArmId: true, academicYearId: true },
    });
    return new Map(
      enrollments.map((e) => [e.studentId, { classArmId: e.classArmId, academicYearId: e.academicYearId }]),
    );
  }

  // Sign-off gate: every component in the school's scheme must have a score for
  // this (student, subject, term). Missing components → ValidationError listing
  // each gap.
  private async assertColumnFullyScored(
    db: TenantDb,
    studentId: string,
    subjectId: string,
    termId: string,
  ): Promise<void> {
    const componentIds = (await db.gradingComponent.findMany({ select: { id: true } })).map((c) => c.id);
    const scored = new Set(
      (
        await db.assessmentScore.findMany({
          where: { studentId, subjectId, termId },
          select: { componentId: true },
        })
      ).map((s) => s.componentId),
    );
    const missing = componentIds.filter((id) => !scored.has(id));
    if (missing.length > 0) {
      throw new ValidationError("All components must be scored before sign-off.", {
        issues: missing.map((componentId) => ({
          path: ["rows", componentId],
          code: "missing_component",
          message: "All components must be scored before sign-off.",
        })),
      });
    }
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
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action,
        entityType,
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
