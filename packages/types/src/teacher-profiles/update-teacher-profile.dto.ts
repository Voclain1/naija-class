import { z } from "zod";

import {
  NUT_NUMBER_MAX,
  QUALIFICATIONS_MAX,
  SPECIALTY_MAX,
  STAFF_NUMBER_MAX,
} from "./create-teacher-profile.dto.js";

// PATCH /teacher-profiles/:id — admin-edit. Partial: any subset of the
// admin-editable fields. `userId` is NOT changeable (the 1:1 link is fixed
// at create; re-pointing a profile at a different user would corrupt the
// staff record — delete + recreate instead). `joinedAt` stays auto-managed.
//
// staffNumber must stay non-null (it's the unique key); the optional HR
// fields are nullable so an admin can clear them.

export const updateTeacherProfileSchema = z
  .object({
    staffNumber: z.string().trim().min(1).max(STAFF_NUMBER_MAX).optional(),
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

export type UpdateTeacherProfileInput = z.infer<
  typeof updateTeacherProfileSchema
>;
