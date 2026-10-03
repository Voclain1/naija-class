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
//   (principalNote was on this list until Phase 8 / CP6a. It is per-ARM, not
//    per-student, and was held back for review; the review's answer was that
//    the released PDF every family downloads already prints it, so the screen
//    withholding it only made the two disagree. It is in the shape now.)
//   dateOfBirth / gender / photoUrl
//     — the student bio block exists on the PDF for identification on paper.
//       A child reading their own results on their own phone does not need
//       to be told their date of birth, and a PII field with no purpose on a
//       screen is a PII field that ends up in a screenshot or a log.

import type { PromotionStatusDto } from "./report-card.dto.js";

/** One subject line. Mirrors the staff shape minus the component breakdown. */
export interface FamilySubjectRowDto {
  subjectId: string;
  subjectName: string;
  totalScore: number;
  letterGrade: string | null;
  remark: string | null;
  /**
   * Populated only when the school shows positions to families
   * (School.positionVisibleToFamilies, Phase 8 / CP6a). Always present as a
   * key so the mobile client never branches on field existence.
   */
  subjectPosition: number | null;
}

/**
 * Attendance for the term, snapshotted when the card was built (Phase 8 /
 * CP6a, §20.2). null when the arm was never marked — which is "no record",
 * and must render as no line at all, never as "0 days".
 */
export interface FamilyAttendanceDto {
  daysOpened: number;
  present: number;
  absent: number;
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
  /**
   * Phase 8c / CP6b (§21.2): released in PIN mode and not yet unlocked for
   * this student. When true the figures above are null — the list says the
   * term exists and needs a PIN, never what is in it.
   */
  locked: boolean;
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
  // The principal's remark for the arm. Already printed on the released PDF;
  // the JSON now says the same thing the paper does (CP6a, §20.4).
  principalNote: string | null;
  attendance: FamilyAttendanceDto | null;
  // Final term only; null on every other term (§20.3).
  promotionStatus: PromotionStatusDto | null;
  subjects: FamilySubjectRowDto[];
  releasedAt: string | Date;
}

export interface ReleasedResultListResponse {
  data: ReleasedResultSummaryDto[];
}
