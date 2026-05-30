import { z } from "zod";

// POST /teacher-profiles — create a profile for an existing User who holds
// the teacher role (Q2 lifecycle: admin-explicit, after the teacher accepts
// their invitation).
//
// Required: userId, staffNumber. The staffNumber is admin-entered + real
// from the start (no placeholder) — that's the whole reason this is an
// explicit create rather than an auto-create on accept.
//
// `joinedAt` is intentionally NOT settable here: the pinned schema treats it
// as the auto row-creation moment (@default(now())). A real admin-entered
// hire date is Phase 3 payroll territory. Optional HR fields are nullable so
// the same shape can clear them on a later PATCH; on create, omit = null.

export const STAFF_NUMBER_MAX = 50;
export const QUALIFICATIONS_MAX = 500;
export const SPECIALTY_MAX = 120;
export const NUT_NUMBER_MAX = 50;

export const createTeacherProfileSchema = z
  .object({
    userId: z.string().uuid(),
    staffNumber: z.string().trim().min(1).max(STAFF_NUMBER_MAX),
    qualifications: z
      .string()
      .trim()
      .min(1)
      .max(QUALIFICATIONS_MAX)
      .nullable()
      .optional(),
    specialty: z.string().trim().min(1).max(SPECIALTY_MAX).nullable().optional(),
    nutNumber: z.string().trim().min(1).max(NUT_NUMBER_MAX).nullable().optional(),
  })
  .strict();

export type CreateTeacherProfileInput = z.infer<
  typeof createTeacherProfileSchema
>;
