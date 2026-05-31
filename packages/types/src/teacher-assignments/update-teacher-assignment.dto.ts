import { z } from "zod";

// PATCH /teacher-assignments/:id — partial update.
//
// The only mutable field is `isActive` — the spec's "toggle isActive"
// (phase-1.md:696). Everything else (teacher, arm, subject, year, term) is
// identity: changing any of them would be a different assignment, so the
// admin deletes and recreates instead. Deactivating (isActive=false) is the
// soft-unassign path — the row stays for history + audit, and the teacher-
// scope filter (cp2) only counts active assignments.
//
// `.strict()` so a caller who tries to PATCH an identity field gets a 400
// rather than a silent no-op.

export const updateTeacherAssignmentSchema = z
  .object({
    isActive: z.boolean().optional(),
  })
  .strict();

export type UpdateTeacherAssignmentInput = z.infer<
  typeof updateTeacherAssignmentSchema
>;
