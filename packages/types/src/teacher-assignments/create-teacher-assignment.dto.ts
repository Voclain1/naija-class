import { z } from "zod";

// POST /teacher-assignments — body schema.
//
// Required: teacherId, classArmId, subjectId, academicYearId. termId is
// OPTIONAL — omit (or send null) for a whole-year assignment, or set it for a
// term-specific one (e.g. a relief teacher covering a single term). The
// server validates that all ids exist in this tenant, that the teacher holds
// the teacher role, and — when termId is set — that the term belongs to
// academicYearId.
//
// No isActive on create: rows are born active. Co-teaching is allowed (two
// teachers may share the same arm+subject+year+term); the only thing rejected
// is the SAME teacher being assigned twice to an identical tuple (409
// TEACHER_ALREADY_ASSIGNED — see the service, which also covers the NULL-term
// case the DB unique misses).

export const createTeacherAssignmentSchema = z
  .object({
    teacherId: z.string().uuid(),
    classArmId: z.string().uuid(),
    subjectId: z.string().uuid(),
    academicYearId: z.string().uuid(),
    termId: z.string().uuid().nullable().optional(),
  })
  .strict();

export type CreateTeacherAssignmentInput = z.infer<
  typeof createTeacherAssignmentSchema
>;
