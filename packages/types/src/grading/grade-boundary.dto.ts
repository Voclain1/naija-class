import { z } from "zod";

import { findBoundaryTilingError } from "./grading-rules.js";

const boundaryFields = {
  letter: z.string().trim().min(1).max(8),
  minScore: z.number().int().min(0).max(100),
  maxScore: z.number().int().min(0).max(100),
  remark: z.string().trim().max(80).optional(),
  orderIndex: z.number().int().min(0).max(1000),
};

// PATCH /grade-boundaries/:id — edit one band. The service re-validates the
// resulting full set tiles 0..100. The min<=max guard binds to maxScore so the
// form can surface it on the right field.
export const updateGradeBoundarySchema = z
  .object(boundaryFields)
  .partial()
  .strict()
  .refine(
    (d) =>
      d.letter !== undefined ||
      d.minScore !== undefined ||
      d.maxScore !== undefined ||
      d.remark !== undefined ||
      d.orderIndex !== undefined,
    { message: "Provide at least one field to update.", path: ["maxScore"] },
  )
  .refine((d) => d.minScore === undefined || d.maxScore === undefined || d.minScore <= d.maxScore, {
    message: "Minimum cannot exceed maximum.",
    path: ["maxScore"],
  });
export type UpdateGradeBoundaryInput = z.infer<typeof updateGradeBoundarySchema>;

// PUT /grade-boundaries — bulk replace the whole scale. Settings UI save path.
//
// Refine discipline (class-arm `as never` lesson): the tiling issue binds to a
// per-row path (["boundaries", i, "maxScore"]) so react-hook-form can surface
// the gap/overlap on the offending band rather than into a void.
export const replaceGradeBoundariesSchema = z
  .object({
    boundaries: z.array(z.object(boundaryFields).strict()).min(1).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Per-row min<=max first, bound to each offending row.
    value.boundaries.forEach((band, index) => {
      if (band.minScore > band.maxScore) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Minimum cannot exceed maximum.",
          path: ["boundaries", index, "maxScore"],
        });
      }
    });

    // Then the whole-set tiling check. Pin the message to the highest band's
    // maxScore — the most common edit mistake is the top band not reaching 100.
    const tilingError = findBoundaryTilingError(value.boundaries);
    if (tilingError) {
      const lastIndex = value.boundaries.length - 1;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: tilingError,
        path: ["boundaries", lastIndex, "maxScore"],
      });
    }

    // Duplicate letters bind to the offending row.
    const seen = new Map<string, number>();
    value.boundaries.forEach((band, index) => {
      if (seen.has(band.letter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate grade letter "${band.letter}".`,
          path: ["boundaries", index, "letter"],
        });
      } else {
        seen.set(band.letter, index);
      }
    });
  });
export type ReplaceGradeBoundariesInput = z.infer<typeof replaceGradeBoundariesSchema>;
