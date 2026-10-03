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
            // EITHER a score already in the component's weight units (as
            // always), OR — Phase 8c / CP5a (D60) — a raw mark and what it was
            // out of, which the SERVER scales. Never both: the server never
            // trusts a client-scaled figure next to the raw mark it came from.
            score: z.number().int().min(0).max(100).optional(),
            raw: z
              .object({
                mark: z.number().int().min(0).max(1000),
                outOf: z.number().int().min(1).max(1000),
              })
              .strict()
              .optional(),
          })
          .strict()
          .refine((r) => (r.score === undefined) !== (r.raw === undefined), {
            message: "Send either a score or a raw mark, not both.",
          }),
      )
      .min(1)
      .max(2000),
  })
  .strict();

export type BulkAssessmentScoreInput = z.infer<typeof bulkAssessmentScoreSchema>;

// POST /assessment-scores/preview — Phase 8c / CP5a (D60). The same rows a
// save would take; the answer is what each would be saved as, and nothing is
// written. Lets a teacher see "37/60 → 12" before committing a column.
export const previewAssessmentScoreSchema = bulkAssessmentScoreSchema;
export type PreviewAssessmentScoreInput = BulkAssessmentScoreInput;

export interface ScorePreviewRowDto {
  studentId: string;
  componentId: string;
  /** What would be stored, in weight units. */
  score: number;
  raw: { mark: number; outOf: number } | null;
}

export interface ScorePreviewResponse {
  rows: ScorePreviewRowDto[];
}
