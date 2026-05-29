import { z } from "zod";

import { ENROLLMENT_STATUS } from "./create-enrollment.dto.js";

// GET /enrollments — list with filters.
//
// Per phase-1.md API table:
//   GET /enrollments?termId=&academicYearId=&classArmId=&studentId=&status=
//
// Filtering semantics:
//   - termId           — one term's roster
//   - academicYearId   — all three terms in that year (without termId)
//   - classArmId       — restrict to that arm
//   - studentId        — restrict to one student's enrollments (history)
//   - status           — restrict to one status (e.g. WITHDRAWN-only)
//
// All filters are optional; combining them ANDs together. The roster
// page sets termId + classArmId; the student-detail Enrollments tab
// sets studentId; the admin-history view can combine year + student.

export const listEnrollmentsQuerySchema = z
  .object({
    termId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
    classArmId: z.string().uuid().optional(),
    studentId: z.string().uuid().optional(),
    status: z.enum(ENROLLMENT_STATUS).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuerySchema>;
