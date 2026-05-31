import { z } from "zod";

// GET /teacher-assignments — list with filters.
//
// Per phase-1.md API table:
//   GET /teacher-assignments?teacherId=&classArmId=&academicYearId=
//
// Filtering semantics (all optional; combining them ANDs together):
//   - teacherId       — one teacher's assignments (the staff-detail view)
//   - classArmId       — who teaches in this arm (the arm-detail view)
//   - academicYearId   — restrict to one year
//   - subjectId        — restrict to one subject
//   - isActive         — restrict to active / inactive only
//
// cursor + limit mirror the other Phase 1 list endpoints (id ASC cursor).
// This is the ADMIN list endpoint (owner|admin only); the teacher's own
// scoped view is a separate dedicated endpoint in cp2.

export const listTeacherAssignmentsQuerySchema = z
  .object({
    teacherId: z.string().uuid().optional(),
    classArmId: z.string().uuid().optional(),
    academicYearId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    isActive: z.coerce.boolean().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();

export type ListTeacherAssignmentsQuery = z.infer<
  typeof listTeacherAssignmentsQuerySchema
>;
