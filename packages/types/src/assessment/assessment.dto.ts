// Assessment DTO shapes returned by the API. Dates serialize as strings over
// JSON; the types accept Date | string so test code can build them with native
// Dates while live-fetch responses arrive as ISO strings (same convention as
// the rest of the codebase).

export interface AssessmentScoreDto {
  id: string;
  studentId: string;
  subjectId: string;
  termId: string;
  componentId: string;
  score: number;
  enteredBy: string;
  enteredAt: string | Date;
  updatedAt: string | Date;
}

// The denormalized per-(student × subject × term) summary. subjectPosition /
// classPosition are null until the slice-4 aggregation pass runs.
export interface AssessmentDto {
  id: string;
  studentId: string;
  subjectId: string;
  termId: string;
  academicYearId: string;
  classArmId: string;
  totalScore: number;
  letterGrade: string | null;
  remark: string | null;
  subjectPosition: number | null;
  classPosition: number | null;
  subjectComment: string | null;
  subjectSignedOffAt: string | Date | null;
  subjectSignedOffBy: string | null;
  computedAt: string | Date;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// One row of the gradebook feed: a student's summary plus the per-component raw
// scores behind it (for the (term, subject) the feed was queried for).
export interface AssessmentWithScoresDto {
  assessment: AssessmentDto;
  scores: AssessmentScoreDto[];
}
