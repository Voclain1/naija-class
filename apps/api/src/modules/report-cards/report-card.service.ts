import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type BuildReportCardsInput,
  type BuildReportCardsResultDto,
  type ReportCardBoardQuery,
  type ReportCardBoardResponse,
  type ReportCardDetailDto,
  type ReportCardDto,
  type ReportCardStudentDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { AggregationService } from "../assessment/aggregation.service";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const AUDIT_BUILD = "report-card.build";

// Phase 2 / Slice 5 cp1 — report-card BUILD + read surface (no PDF; cp2 renders).
// Build runs the slice-4 full aggregation IN-TX, then snapshots the term rollup
// onto one DRAFT ReportCard per enrolled student (so the PDF reads a frozen
// rollup, not a live recompute).
@Injectable()
export class ReportCardService {
  constructor(private readonly aggregation: AggregationService) {}

  // POST /report-cards/arm/build — owner/admin only.
  async build(
    authCtx: AuthContext,
    input: BuildReportCardsInput,
    reqCtx: RequestContext,
  ): Promise<BuildReportCardsResultDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({ where: { id: input.termId }, select: { id: true } });
      if (!term) throw new NotFoundError("Term not found.");
      const arm = await db.classArm.findUnique({ where: { id: input.classArmId }, select: { id: true } });
      if (!arm) throw new NotFoundError("Class arm not found.");

      // 1. Fresh positions FIRST, atomically in this tx (Q1b). The full pass sets
      //    subjectPosition + classPosition on every Assessment row in the arm.
      await this.aggregation.aggregateArmInTx(db, input.termId, input.classArmId);

      // 2. The ENROLLED roster is the set of cards to build (one per student).
      const enrollments = await db.enrollment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId, status: "ENROLLED" },
        select: { studentId: true, academicYearId: true },
      });
      const studentIds = enrollments.map((e) => e.studentId);

      // 3. Each student's Assessment rows → the rollup snapshot.
      const assessments = await db.assessment.findMany({
        where: { termId: input.termId, classArmId: input.classArmId, studentId: { in: studentIds } },
        select: { studentId: true, totalScore: true, classPosition: true },
      });
      const byStudent = new Map<string, { totals: number[]; classPosition: number | null }>();
      for (const a of assessments) {
        const entry = byStudent.get(a.studentId) ?? { totals: [], classPosition: null };
        entry.totals.push(a.totalScore);
        // classPosition is denormalized identically across a student's subject
        // rows after the full pass — take it from any of them.
        if (a.classPosition !== null) entry.classPosition = a.classPosition;
        byStudent.set(a.studentId, entry);
      }

      let cardCount = 0;
      for (const enrollment of enrollments) {
        const rollup = byStudent.get(enrollment.studentId) ?? { totals: [], classPosition: null };
        const subjectsCount = rollup.totals.length;
        const overallTotal = subjectsCount > 0 ? rollup.totals.reduce((s, t) => s + t, 0) : null;
        const overallAverage =
          overallTotal !== null && subjectsCount > 0
            ? Math.round((overallTotal * 100) / subjectsCount) // Int hundredths (kobo rule)
            : null;

        await db.reportCard.upsert({
          where: {
            schoolId_studentId_termId: {
              schoolId: authCtx.schoolId,
              studentId: enrollment.studentId,
              termId: input.termId,
            },
          },
          create: {
            schoolId: authCtx.schoolId,
            studentId: enrollment.studentId,
            termId: input.termId,
            academicYearId: enrollment.academicYearId,
            classArmId: input.classArmId,
            overallTotal,
            overallAverage,
            overallPosition: rollup.classPosition,
            subjectsCount,
          },
          // Re-build refreshes the ROLLUP only — it must not clobber the workflow
          // state (slice 6), the comments, or the PDF pointer.
          update: {
            classArmId: input.classArmId,
            academicYearId: enrollment.academicYearId,
            overallTotal,
            overallAverage,
            overallPosition: rollup.classPosition,
            subjectsCount,
          },
          select: { id: true },
        });
        cardCount += 1;
      }

      await this.writeAudit(db, authCtx, reqCtx, input.classArmId, {
        termId: input.termId,
        classArmId: input.classArmId,
        cardCount,
        mode: "build-with-aggregate",
      });

      return { cardCount, studentCount: studentIds.length };
    });
  }

  // GET /report-cards?termId=&classArmId=&status= — the workflow board.
  async getBoard(authCtx: AuthContext, query: ReportCardBoardQuery): Promise<ReportCardBoardResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanReadArm(db, authCtx, query.classArmId);

      const cards = await db.reportCard.findMany({
        where: {
          termId: query.termId,
          classArmId: query.classArmId,
          ...(query.status ? { status: query.status } : {}),
        },
        select: REPORT_CARD_SELECT,
      });
      const students = await db.student.findMany({
        where: { id: { in: cards.map((c) => c.studentId) } },
        select: STUDENT_BIO_SELECT,
      });
      const studentById = new Map(students.map((s) => [s.id, s]));

      const rows = cards
        .map((card) => ({ card, student: studentById.get(card.studentId) }))
        .filter((r): r is { card: (typeof cards)[number]; student: StudentBioRow } => r.student !== undefined)
        .sort((a, b) =>
          a.student.lastName.localeCompare(b.student.lastName) ||
          a.student.firstName.localeCompare(b.student.firstName),
        )
        .map((r) => ({ student: toStudentDto(r.student), reportCard: toReportCardDto(r.card) }));

      return { data: rows };
    });
  }

  // GET /report-cards/:id — single card with the per-subject breakdown.
  async getById(authCtx: AuthContext, id: string): Promise<ReportCardDetailDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const card = await db.reportCard.findUnique({ where: { id }, select: REPORT_CARD_SELECT });
      if (!card) throw new NotFoundError("Report card not found.");
      await this.assertCanReadArm(db, authCtx, card.classArmId);

      const student = await db.student.findUnique({
        where: { id: card.studentId },
        select: STUDENT_BIO_SELECT,
      });
      if (!student) throw new NotFoundError("Report card not found.");

      const subjects = await this.buildSubjectBreakdown(db, card.studentId, card.termId);
      return { reportCard: toReportCardDto(card), student: toStudentDto(student), subjects };
    });
  }

  // =========================================================================
  // Internals
  // =========================================================================

  // Owner/admin read any arm; a teacher reads ONLY the arm they are the FORM
  // teacher of (subject teachers are NOT in slice-5 read scope). Else → 404.
  private async assertCanReadArm(db: TenantDb, authCtx: AuthContext, classArmId: string): Promise<void> {
    const arm = await db.classArm.findUnique({
      where: { id: classArmId },
      select: { id: true, classTeacherId: true },
    });
    if (!arm) throw new NotFoundError("Class arm not found.");

    const roleKeys = (
      await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: { role: { select: { key: true } } },
      })
    ).map((g) => g.role.key);

    if (roleKeys.includes("owner") || roleKeys.includes("admin")) return;
    if (roleKeys.includes("teacher") && arm.classTeacherId === authCtx.userId) return;
    throw new NotFoundError("Class arm not found.");
  }

  // The per-subject grid: each subject's Assessment summary + the per-component
  // raw scores behind it. Shared by GET /:id (and the cp2 render worker).
  private async buildSubjectBreakdown(
    db: TenantDb,
    studentId: string,
    termId: string,
  ): Promise<ReportCardDetailDto["subjects"]> {
    const assessments = await db.assessment.findMany({
      where: { studentId, termId },
      select: {
        subjectId: true,
        totalScore: true,
        letterGrade: true,
        remark: true,
        subjectPosition: true,
        subjectComment: true,
      },
    });
    if (assessments.length === 0) return [];

    const subjectIds = assessments.map((a) => a.subjectId);
    const subjects = await db.subject.findMany({
      where: { id: { in: subjectIds } },
      select: { id: true, name: true },
    });
    const subjectName = new Map(subjects.map((s) => [s.id, s.name]));

    const scores = await db.assessmentScore.findMany({
      where: { studentId, termId, subjectId: { in: subjectIds } },
      select: { subjectId: true, componentId: true, score: true },
    });
    const components = await db.gradingComponent.findMany({ select: { id: true, label: true, orderIndex: true } });
    const componentLabel = new Map(components.map((c) => [c.id, c.label]));
    const componentOrder = new Map(components.map((c) => [c.id, c.orderIndex]));

    const scoresBySubject = new Map<string, { componentId: string; label: string; score: number }[]>();
    for (const s of scores) {
      const list = scoresBySubject.get(s.subjectId) ?? [];
      list.push({ componentId: s.componentId, label: componentLabel.get(s.componentId) ?? "", score: s.score });
      scoresBySubject.set(s.subjectId, list);
    }

    return assessments
      .sort((a, b) => (subjectName.get(a.subjectId) ?? "").localeCompare(subjectName.get(b.subjectId) ?? ""))
      .map((a) => ({
        subjectId: a.subjectId,
        subjectName: subjectName.get(a.subjectId) ?? "",
        totalScore: a.totalScore,
        letterGrade: a.letterGrade,
        remark: a.remark,
        subjectPosition: a.subjectPosition,
        subjectComment: a.subjectComment,
        components: (scoresBySubject.get(a.subjectId) ?? []).sort(
          (x, y) => (componentOrder.get(x.componentId) ?? 0) - (componentOrder.get(y.componentId) ?? 0),
        ),
      }));
  }

  private async writeAudit(
    db: TenantDb,
    authCtx: AuthContext,
    reqCtx: RequestContext,
    classArmId: string,
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await db.auditLog.create({
      data: {
        schoolId: authCtx.schoolId,
        userId: authCtx.userId,
        action: AUDIT_BUILD,
        entityType: "report_card",
        entityId: classArmId,
        ipAddress: reqCtx.ipAddress,
        metadata,
      },
    });
  }
}

// -------------------------------------------------------------------------
// Selects + mappers
// -------------------------------------------------------------------------

const REPORT_CARD_SELECT = {
  id: true,
  studentId: true,
  termId: true,
  academicYearId: true,
  classArmId: true,
  status: true,
  overallTotal: true,
  overallAverage: true,
  overallPosition: true,
  subjectsCount: true,
  formTeacherComment: true,
  principalNote: true,
  pdfStatus: true,
  artifactUrl: true,
  generatedAt: true,
  releasedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ReportCardSelect;

const STUDENT_BIO_SELECT = {
  id: true,
  admissionNumber: true,
  firstName: true,
  middleName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  photoUrl: true,
} satisfies Prisma.StudentSelect;

type ReportCardRow = Prisma.ReportCardGetPayload<{ select: typeof REPORT_CARD_SELECT }>;
type StudentBioRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_BIO_SELECT }>;

function toReportCardDto(row: ReportCardRow): ReportCardDto {
  return {
    id: row.id,
    studentId: row.studentId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    classArmId: row.classArmId,
    status: row.status,
    overallTotal: row.overallTotal,
    overallAverage: row.overallAverage,
    overallPosition: row.overallPosition,
    subjectsCount: row.subjectsCount,
    formTeacherComment: row.formTeacherComment,
    principalNote: row.principalNote,
    pdfStatus: row.pdfStatus,
    artifactUrl: row.artifactUrl,
    generatedAt: row.generatedAt,
    releasedAt: row.releasedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStudentDto(row: StudentBioRow): ReportCardStudentDto {
  return {
    id: row.id,
    admissionNumber: row.admissionNumber,
    firstName: row.firstName,
    middleName: row.middleName,
    lastName: row.lastName,
    gender: row.gender,
    dateOfBirth: row.dateOfBirth,
    photoUrl: row.photoUrl,
  };
}
