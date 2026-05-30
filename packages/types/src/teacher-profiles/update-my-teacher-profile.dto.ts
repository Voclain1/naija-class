import { z } from "zod";

import {
  QUALIFICATIONS_MAX,
  SPECIALTY_MAX,
} from "./create-teacher-profile.dto.js";

// PATCH /teacher-profiles/me — teacher self-service. A teacher may edit ONLY
// their bio fields (specialty, qualifications). Admin-only fields
// (staffNumber, nutNumber) are rejected by `.strict()` — a teacher who
// smuggles `staffNumber` in the body gets a 400, not a silent no-op. This is
// the `teacher-profile.self.update` permission surface from phase-1.md:1087.

export const updateMyTeacherProfileSchema = z
  .object({
    specialty: z.string().trim().min(1).max(SPECIALTY_MAX).nullable().optional(),
    qualifications: z
      .string()
      .trim()
      .min(1)
      .max(QUALIFICATIONS_MAX)
      .nullable()
      .optional(),
  })
  .strict();

export type UpdateMyTeacherProfileInput = z.infer<
  typeof updateMyTeacherProfileSchema
>;
