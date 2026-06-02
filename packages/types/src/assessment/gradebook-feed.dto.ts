import { z } from "zod";

import type { AssessmentDto, AssessmentScoreDto } from "./assessment.dto.js";

// GET /assessments?termId=&classArmId=&subjectId= — the gradebook column feed.
// All three are required: the feed is always scoped to one (arm, subject, term).
export const assessmentFeedQuerySchema = z
  .object({
    termId: z.string().trim().min(1),
    classArmId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
  })
  .strict();

export type AssessmentFeedQuery = z.infer<typeof assessmentFeedQuerySchema>;

// Trimmed student identity for the gradebook row — id + name + admission number.
// Deliberately omits PII a gradebook column does not need (same posture as the
// teacher roster's TeacherRosterStudentDto).
export interface AssessmentFeedStudentDto {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
}

// One row per enrolled student: their identity, their materialized summary for
// the (subject, term) — null if no score entered yet — and the per-component raw
// scores behind it.
export interface AssessmentFeedRowDto {
  student: AssessmentFeedStudentDto;
  assessment: AssessmentDto | null;
  scores: AssessmentScoreDto[];
}

export interface AssessmentFeedResponse {
  data: AssessmentFeedRowDto[];
}
