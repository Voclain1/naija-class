// Phase 6 / Slice 4 — what a FAMILY sees of a report card.
//
// One shape, read by two principals (the student on mobile, the guardian in
// the portal). Deliberately NOT two DTOs: D30. If the two audiences ever need
// different fields that becomes a named decision, not an accident of two
// people writing two interfaces on different days.
//
// This is a deliberately NARROWER shape than the staff-facing
// ReportCardDetailDto. What is missing and why:
//
//   status / releasedAt / pdfStatus / artifactUrl / generatedAt
//     — workflow plumbing. A family sees a card because it was released;
//       showing them which stage it sits at invites questions about a
//       process that is the school's, not theirs.
//   principalNote
//     — per-ARM, not per-student. It is on the PDF because the PDF is the
//       school's own document; surfacing it in-app would mean a family
//       reading a remark written about a class, presented on their child's
//       screen. Deliberate omission, flagged for review with the school.
//   dateOfBirth / gender / photoUrl
//     — the student bio block exists on the PDF for identification on paper.
//       A child reading their own results on their own phone does not need
//       to be told their date of birth, and a PII field with no purpose on a
//       screen is a PII field that ends up in a screenshot or a log.

/** One subject line. Mirrors the staff shape minus the component breakdown. */
export interface FamilySubjectRowDto {
  subjectId: string;
  subjectName: string;
  totalScore: number;
  letterGrade: string | null;
  remark: string | null;
  /**
   * Populated only when positions are family-visible — see
   * FAMILY_VISIBLE_POSITION in released-results.service.ts. Always present as
   * a key so the mobile client never branches on field existence.
   */
  subjectPosition: number | null;
}

/** One released term, as it appears in a list. */
export interface ReleasedResultSummaryDto {
  reportCardId: string;
  termId: string;
  termName: string;
  academicYearLabel: string;
  classArmName: string;
  overallAverage: number | null; // Int hundredths (7350 = 73.50%)
  subjectsCount: number | null;
  releasedAt: string | Date;
}

/** One released term, in full. */
export interface ReleasedResultDetailDto {
  reportCardId: string;
  termId: string;
  termName: string;
  academicYearLabel: string;
  classArmName: string;
  schoolName: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    admissionNumber: string;
  };
  overallTotal: number | null;
  overallAverage: number | null; // Int hundredths
  overallPosition: number | null; // null unless positions are family-visible
  subjectsCount: number | null;
  formTeacherComment: string | null;
  subjects: FamilySubjectRowDto[];
  releasedAt: string | Date;
}

export interface ReleasedResultListResponse {
  data: ReleasedResultSummaryDto[];
}
