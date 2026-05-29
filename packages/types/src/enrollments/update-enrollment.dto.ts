import { z } from "zod";

import { ENROLLMENT_STATUS } from "./create-enrollment.dto.js";

// PATCH /enrollments/:id — partial update.
//
// What admins can change:
//   - classArmId   — move student to a different arm WITHIN the same
//                    term. Rare; mid-term arm transfers are spec'd as
//                    next-term-row, not as PATCH on this term's row.
//                    Allowed here as the escape hatch for back-fill
//                    corrections.
//   - status       — flip ENROLLED↔WITHDRAWN/GRADUATED/etc. The
//                    cascade from student.withdraw / student.graduate
//                    (slice 9 extension) calls this same path; manual
//                    PATCH is for admin corrections.
//   - notes        — free-text commentary.
//   - withdrawnAt  — explicit timestamp override (defaults to "now"
//                    when status flips to WITHDRAWN without one).
//
// What admins CANNOT change via PATCH:
//   - studentId   — moving an enrollment between students would
//                   corrupt history; recreate as a new row instead.
//   - termId      — same reason.
//   - academicYearId — derived from term at write time.

export const updateEnrollmentSchema = z
  .object({
    classArmId: z.string().uuid().optional(),
    status: z.enum(ENROLLMENT_STATUS).optional(),
    withdrawnAt: z.coerce.date().nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict();

export type UpdateEnrollmentInput = z.infer<typeof updateEnrollmentSchema>;
