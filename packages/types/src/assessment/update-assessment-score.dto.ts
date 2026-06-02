import { z } from "zod";

// PATCH /assessment-scores/:id — correct a single score. Only the score is
// mutable; the (student, subject, term, component) tuple is fixed at create.
// Coarse 0..100 bound here; the service re-validates against the live component
// weight.
export const updateAssessmentScoreSchema = z
  .object({
    score: z.number().int().min(0).max(100),
  })
  .strict();

export type UpdateAssessmentScoreInput = z.infer<typeof updateAssessmentScoreSchema>;
