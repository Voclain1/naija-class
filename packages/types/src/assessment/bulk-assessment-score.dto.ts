import { z } from "zod";

// POST /assessment-scores/bulk — one gradebook column save: many
// (student × component) cells for a single (subject, term). ATOMIC all-or-nothing
// (phase-2.md Q2a): the service pre-validates every row (strict 0..weight +
// teacher scope + enrollment) before a single write, then materializes one
// Assessment summary per distinct student in one tx. The cap is generous —
// a large arm (~40 students × a handful of components) stays well under it
// while still bounding a runaway request.
export const bulkAssessmentScoreSchema = z
  .object({
    termId: z.string().trim().min(1),
    subjectId: z.string().trim().min(1),
    rows: z
      .array(
        z
          .object({
            studentId: z.string().trim().min(1),
            componentId: z.string().trim().min(1),
            score: z.number().int().min(0).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export type BulkAssessmentScoreInput = z.infer<typeof bulkAssessmentScoreSchema>;
