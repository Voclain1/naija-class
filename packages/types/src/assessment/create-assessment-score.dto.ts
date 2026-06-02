import { z } from "zod";

// POST /assessment-scores — enter or correct one component's mark for a
// (student × subject × term). `score` gets a COARSE bound here (integer 0..100,
// since no component weight exceeds 100); the service re-validates the exact
// 0..component.weight ceiling against the LIVE component row (phase-2.md Hard
// rules "Validate at the DTO AND re-validate in the service").
export const createAssessmentScoreSchema = z
  .object({
    studentId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    termId: z.string().trim().min(1),
    componentId: z.string().trim().min(1),
    score: z.number().int().min(0).max(100),
  })
  .strict();

export type CreateAssessmentScoreInput = z.infer<typeof createAssessmentScoreSchema>;
