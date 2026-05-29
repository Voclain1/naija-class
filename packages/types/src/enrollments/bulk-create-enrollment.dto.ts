import { z } from "zod";

// POST /enrollments/bulk — body schema.
//
// The realistic admin scenario at term boundary: "Term 2 starts, carry
// over JSS 1A's roster from Term 1." The wizard computes studentIds
// from the previous term's enrollments + the spec's three-group logic
// (carried over / withdrew last term / admitted after term 1) and POSTs
// the resulting array here.
//
// Idempotent: if a (student, term) row already exists, the server
// silently skips it (counted in `skipped`, not `created`). Re-running
// the same payload is safe.
//
// Cap: 1000 students per call. The acceptance bar (250 students per
// pilot school) is well under this; the cap protects against an
// accidentally-massive payload locking the per-row transactions for
// minutes.

export const bulkCreateEnrollmentSchema = z
  .object({
    termId: z.string().uuid(),
    classArmId: z.string().uuid(),
    studentIds: z
      .array(z.string().uuid())
      .min(1, "studentIds must contain at least one student")
      .max(1000, "studentIds must not exceed 1000 entries per call"),
  })
  .strict();

export type BulkCreateEnrollmentInput = z.infer<
  typeof bulkCreateEnrollmentSchema
>;
