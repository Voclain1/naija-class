import { z } from "zod";

// POST /promotions/commit — body schema.
//
// The client sends an EXPLICIT decision per student. Nothing is inferred at
// commit time: the server re-derives the preview and refuses any decision for
// a student who does not hold a real source-term enrollment (see
// docs/modules/promotion-engine.md D4). A student omitted from `decisions` is
// simply not touched.
const promotionActionValues = [
  "PROMOTE",
  "REPEAT",
  "GRADUATE",
  "EXCLUDE",
] as const;

export const promotionDecisionSchema = z
  .object({
    studentId: z.string().uuid(),
    action: z.enum(promotionActionValues),
    /**
     * Required for PROMOTE and REPEAT, forbidden for GRADUATE and EXCLUDE.
     * Sent even when it equals the engine's proposal — the server never
     * fills in a destination arm on the admin's behalf, so a row can only
     * land where the screen said it would.
     */
    classArmId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsArm = value.action === "PROMOTE" || value.action === "REPEAT";
    if (needsArm && !value.classArmId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["classArmId"],
        message: `classArmId is required when action is ${value.action}.`,
      });
    }
    if (!needsArm && value.classArmId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["classArmId"],
        message: `classArmId must be omitted when action is ${value.action}.`,
      });
    }
  });

export const commitPromotionSchema = z
  .object({
    sourceTermId: z.string().uuid(),
    targetTermId: z.string().uuid(),
    decisions: z.array(promotionDecisionSchema).min(1).max(5000),
    /**
     * Must be true when any decision is GRADUATE. Graduating writes
     * `Student.status = GRADUATED`, which is the only thing this endpoint does
     * that reaches outside the two terms being rolled — so it gets its own
     * deliberate act, not a row buried in a list of hundreds.
     */
    confirmGraduations: z.boolean().optional(),
  })
  .strict();

export type PromotionDecisionInput = z.infer<typeof promotionDecisionSchema>;
export type CommitPromotionInput = z.infer<typeof commitPromotionSchema>;
