import { z } from "zod";

// POST /enrollments — body schema.
//
// Required: studentId, termId, classArmId. The server resolves
// academicYearId from termId at write time — the client never sends it
// (and a future migration might add a CHECK constraint that would
// reject a request that did). `status` defaults to ENROLLED; admins
// rarely set it explicitly at creation (PROMOTED / REPEATED / GRADUATED
// arrive via PATCH or via the slice-9 cascade from student transitions).
//
// `notes` is optional free-text — admin commentary like "joined mid-
// term from another school"; capped to keep audit metadata bounded.

const ENROLLMENT_STATUS_VALUES = [
  "ENROLLED",
  "TRANSFERRED",
  "PROMOTED",
  "REPEATED",
  "WITHDRAWN",
  "GRADUATED",
] as const;
export const ENROLLMENT_STATUS = ENROLLMENT_STATUS_VALUES;

export const createEnrollmentSchema = z
  .object({
    studentId: z.string().uuid(),
    termId: z.string().uuid(),
    classArmId: z.string().uuid(),
    status: z.enum(ENROLLMENT_STATUS_VALUES).optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict();

export type CreateEnrollmentInput = z.infer<typeof createEnrollmentSchema>;
