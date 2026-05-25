import { z } from "zod";

// POST /students/:id/withdraw — body shape.
//
// Both fields optional. `withdrawnAt` defaults to the request's "now"
// when omitted (matches the typical UX of "withdrew today"). `reason` is
// free text up to 500 chars — lands in audit metadata. Strict so a stray
// extra field surfaces as a 400 rather than being silently ignored.
export const withdrawStudentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    withdrawnAt: z.coerce.date().optional(),
  })
  .strict();

export type WithdrawStudentInput = z.infer<typeof withdrawStudentSchema>;

// POST /students/:id/graduate — body shape. Same logic as withdraw.
export const graduateStudentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
    graduatedAt: z.coerce.date().optional(),
  })
  .strict();

export type GraduateStudentInput = z.infer<typeof graduateStudentSchema>;

// POST /students/:id/reactivate — empty body. We accept (and ignore) a
// reason field for symmetry with withdraw/graduate so a future audit
// schema upgrade is non-breaking.
export const reactivateStudentSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .optional();

export type ReactivateStudentInput = z.infer<typeof reactivateStudentSchema>;
