import { Injectable } from "@nestjs/common";

import { Prisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type FamilySubjectRowDto,
  type ReleasedResultDetailDto,
  type ReleasedResultSummaryDto,
} from "@school-kit/types";

// Phase 6 / Slice 4 — THE family-facing read of a report card. D28.
//
// Both the student (StudentAuthGuard, apps/mobile) and the guardian
// (GuardianAuthGuard, apps/portal) read results through this service and
// nowhere else. Neither controller may query `report_cards` directly.
//
// WHY A SHARED SERVICE RATHER THAN TWO ENDPOINTS THAT FILTER THE SAME WAY.
// The constraint this slice was built under is "nothing is shown to the
// student earlier than it is shown to the guardian". Two endpoints applying
// the same `status: "RELEASED"` filter satisfy that on the day they are
// written, and stop satisfying it the first time somebody edits one of them —
// at which point nothing fails, no test goes red, and a child is reading
// unreleased marks. Putting the filter in one function makes the guarantee
// structural rather than a convention two files happen to share. Same
// reasoning as the SECURITY DEFINER cadence review's refusal to merge the
// session resolvers, applied in the opposite direction: there, separateness
// was the guarantee; here, sharedness is.
//
// The filter is on `status`, NOT on `releasedAt !== null`. They agree today.
// They are not the same claim: `status` is the school's decision, recorded by
// an owner/admin-only transition, and `releasedAt` is a timestamp column that
// a backfill, a data repair, or a future import could set without anyone
// deciding anything. Read the decision, not its side effect.
//
// Tenancy: every call takes an already-tenant-scoped `db`, so RLS confines
// rows to one school. RLS does NOT separate families within a school — that
// was measured in slice 3 (D27) — so the CALLER is responsible for proving
// the requester may see this student: the student guard pins studentId to the
// session, and the guardian path goes through assertLinked().

/**
 * Whether a family sees class/subject positions.
 *
 * Currently FALSE. Not because rank is private — it is the student's own
 * datum and discloses no other child's score — but because whether to show it
 * belongs to the SCHOOL, and there is no school-level setting yet. Some
 * schools rank deliberately and publish it; others have moved away from it.
 * Until that switch exists, hiding is the reversible direction: showing a
 * position later is additive, withdrawing one a family has already seen is a
 * retraction.
 *
 * Note the released PDF template DOES render "Position in Class" as one of
 * its four headline boxes. That is not a contradiction to be fixed by
 * flipping this flag — it is the same missing school-level setting showing up
 * on a second surface, and both should move together when it lands.
 *
 * Flipping this to `true` is the entire change; no call site branches on it.
 */
export const FAMILY_VISIBLE_POSITION = false;

// Same local alias the rest of this module uses — `withTenant`'s callback
// parameter. Not exported by @school-kit/db.
type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

const RELEASED = "RELEASED" satisfies Prisma.ReportCardWhereInput["status"];

const SUMMARY_SELECT = {
  id: true,
  termId: true,
  classArmId: true,
  academicYearId: true,
  overallAverage: true,
  subjectsCount: true,
  releasedAt: true,
} satisfies Prisma.ReportCardSelect;

const DETAIL_SELECT = {
  id: true,
  schoolId: true,
  studentId: true,
  termId: true,
  classArmId: true,
  academicYearId: true,
  overallTotal: true,
  overallAverage: true,
  overallPosition: true,
  subjectsCount: true,
  formTeacherComment: true,
  releasedAt: true,
} satisfies Prisma.ReportCardSelect;

@Injectable()
export class ReleasedResultsService {
  /**
   * Every released card for one student, newest first. An empty array is a
   * normal, expected answer — most students have nothing released for most of
   * the year (D33) — and is never an error.
   */
  async listForStudent(db: TenantDb, studentId: string): Promise<ReleasedResultSummaryDto[]> {
    const cards = await db.reportCard.findMany({
      where: { studentId, status: RELEASED },
      select: SUMMARY_SELECT,
      orderBy: { releasedAt: "desc" },
    });
    if (cards.length === 0) return [];

    const [terms, years, arms] = await Promise.all([
      db.term.findMany({
        where: { id: { in: [...new Set(cards.map((c) => c.termId))] } },
        select: { id: true, name: true },
      }),
      db.academicYear.findMany({
        where: { id: { in: [...new Set(cards.map((c) => c.academicYearId))] } },
        select: { id: true, label: true },
      }),
      db.classArm.findMany({
        where: { id: { in: [...new Set(cards.map((c) => c.classArmId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const termName = new Map(terms.map((t) => [t.id, t.name]));
    const yearLabel = new Map(years.map((y) => [y.id, y.label]));
    const armName = new Map(arms.map((a) => [a.id, a.name]));

    return cards.map((c) => ({
      reportCardId: c.id,
      termId: c.termId,
      termName: termName.get(c.termId) ?? "",
      academicYearLabel: yearLabel.get(c.academicYearId) ?? "",
      classArmName: armName.get(c.classArmId) ?? "",
      overallAverage: c.overallAverage,
      subjectsCount: c.subjectsCount,
      // Non-null by the RELEASED filter: the transition that sets the status
      // stamps the timestamp in the same write.
      releasedAt: c.releasedAt as Date,
    }));
  }

  /**
   * One released card, addressed BY TERM rather than by report-card id.
   *
   * Deliberate: a family navigates by "last term's results", not by a uuid
   * they have never seen. It also removes a whole class of mistake — a
   * card-id route invites a handler that loads the card first and checks
   * ownership second, which is the shape that leaks. Here the studentId is
   * part of the lookup, so a card belonging to someone else cannot be
   * addressed at all.
   *
   * Throws NotFoundError when the term has no card, or has one that is not
   * released. Those two are deliberately indistinguishable: "your school has
   * not released this yet" and "there is nothing here" are the same answer to
   * a family, and distinguishing them would leak the existence of a draft.
   */
  async getForStudent(
    db: TenantDb,
    studentId: string,
    termId: string,
  ): Promise<ReleasedResultDetailDto> {
    const card = await db.reportCard.findFirst({
      where: { studentId, termId, status: RELEASED },
      select: DETAIL_SELECT,
    });
    if (!card) throw new NotFoundError("No released results for this term.");

    const [school, term, year, arm, student, assessments] = await Promise.all([
      // `schools` is the tenant table and carries no RLS policy of its own —
      // it must be filtered by the card's school_id explicitly. Same note as
      // ReportCardService.getRenderData.
      db.school.findUnique({ where: { id: card.schoolId }, select: { name: true } }),
      db.term.findUnique({ where: { id: card.termId }, select: { name: true } }),
      db.academicYear.findUnique({ where: { id: card.academicYearId }, select: { label: true } }),
      db.classArm.findUnique({ where: { id: card.classArmId }, select: { name: true } }),
      db.student.findUnique({
        where: { id: card.studentId },
        select: { id: true, firstName: true, lastName: true, admissionNumber: true },
      }),
      db.assessment.findMany({
        where: { studentId, termId },
        select: {
          subjectId: true,
          totalScore: true,
          letterGrade: true,
          remark: true,
          subjectPosition: true,
        },
      }),
    ]);
    if (!school || !term || !year || !arm || !student) {
      throw new NotFoundError("No released results for this term.");
    }

    // `Assessment.subjectId` is a plain scoping column, not a declared
    // relation (schema convention), so names come from a second read.
    const subjectRows = await db.subject.findMany({
      where: { id: { in: [...new Set(assessments.map((a) => a.subjectId))] } },
      select: { id: true, name: true },
    });
    const subjectName = new Map(subjectRows.map((s) => [s.id, s.name]));

    const subjects: FamilySubjectRowDto[] = assessments
      .map((a) => ({
        subjectId: a.subjectId,
        subjectName: subjectName.get(a.subjectId) ?? "",
        totalScore: a.totalScore,
        letterGrade: a.letterGrade,
        remark: a.remark,
        subjectPosition: FAMILY_VISIBLE_POSITION ? a.subjectPosition : null,
      }))
      .sort((x, y) => x.subjectName.localeCompare(y.subjectName));

    return {
      reportCardId: card.id,
      termId: card.termId,
      termName: term.name,
      academicYearLabel: year.label,
      classArmName: arm.name,
      schoolName: school.name,
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        admissionNumber: student.admissionNumber,
      },
      overallTotal: card.overallTotal,
      overallAverage: card.overallAverage,
      overallPosition: FAMILY_VISIBLE_POSITION ? card.overallPosition : null,
      subjectsCount: card.subjectsCount,
      formTeacherComment: card.formTeacherComment,
      subjects,
      releasedAt: card.releasedAt as Date,
    };
  }
}
