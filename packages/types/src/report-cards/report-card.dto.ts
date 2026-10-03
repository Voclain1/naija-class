// Report-card DTO shapes (Phase 2 / Slice 5). Dates serialize as strings over
// JSON; the types accept Date | string (the codebase convention).

export type ReportCardStatusDto =
  | "DRAFT"
  | "SUBJECT_REVIEWED"
  | "FORM_REVIEWED"
  | "PRINCIPAL_APPROVED"
  | "RELEASED";

// Phase 8 / CP6a (§20.3, D52) — the end-of-year decision, final term only.
export type PromotionStatusDto = "PROMOTED" | "PROMOTED_ON_TRIAL" | "REPEAT" | "GRADUATED";

export const PROMOTION_STATUS_LABELS: Record<PromotionStatusDto, string> = {
  PROMOTED: "Promoted",
  PROMOTED_ON_TRIAL: "Promoted on trial",
  REPEAT: "To repeat",
  GRADUATED: "Graduated",
};

export type ReportCardPdfStatusDto = "PENDING" | "GENERATING" | "GENERATED" | "FAILED";

// The materialized report-card row (rollup + workflow state + PDF pointer).
export interface ReportCardDto {
  id: string;
  studentId: string;
  termId: string;
  academicYearId: string;
  classArmId: string;
  status: ReportCardStatusDto;
  overallTotal: number | null;
  overallAverage: number | null; // Int hundredths (7350 = 73.50%)
  overallPosition: number | null;
  subjectsCount: number | null;
  formTeacherComment: string | null;
  principalNote: string | null;
  // Attendance snapshot taken at build (§20.2). All three null when the arm was
  // never marked this term — "no record", which must not render as 0 days.
  attendanceDaysOpened: number | null;
  attendancePresent: number | null;
  attendanceAbsent: number | null;
  // Final term only (§20.3); null on every other term, and until it is set.
  promotionStatus: PromotionStatusDto | null;
  pdfStatus: ReportCardPdfStatusDto;
  artifactUrl: string | null;
  generatedAt: string | Date | null;
  releasedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Student bio the report card renders (the card IS the student's record, so the
// bio fields are appropriate on this owner/admin/form-teacher-gated endpoint).
export interface ReportCardStudentDto {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: string;
  dateOfBirth: string | Date;
  photoUrl: string | null;
}

// One subject row of the single-card breakdown: the Assessment summary plus the
// per-component raw scores (CA1/CA2/Exam) behind it.
export interface ReportCardSubjectRowDto {
  subjectId: string;
  subjectName: string;
  totalScore: number;
  letterGrade: string | null;
  remark: string | null;
  subjectPosition: number | null;
  subjectComment: string | null;
  components: { componentId: string; label: string; score: number }[];
}

// GET /report-cards/:id — the full single-card view (card + bio + per-subject
// grid). The cp2 render worker reads the same shape to build the PDF.
export interface ReportCardDetailDto {
  reportCard: ReportCardDto;
  student: ReportCardStudentDto;
  subjects: ReportCardSubjectRowDto[];
}

// GET /report-cards?termId=&classArmId=&status= — the workflow board: one row
// per student in the arm with their card.
export interface ReportCardBoardRowDto {
  student: ReportCardStudentDto;
  reportCard: ReportCardDto;
}

export interface ReportCardBoardResponse {
  data: ReportCardBoardRowDto[];
  // True when the term is the last of its academic year — the only term whose
  // cards take a promotion status, and whose approval requires one (§20.3).
  isFinalTerm: boolean;
}

// POST /report-cards/arm/build — result summary.
export interface BuildReportCardsResultDto {
  cardCount: number;
  studentCount: number;
}
