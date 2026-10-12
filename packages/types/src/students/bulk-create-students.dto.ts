import { z } from "zod";

import { createStudentSchema } from "./create-student.dto.js";
import type { StudentDto } from "./student.dto.js";

// POST /students/bulk — the bulk add grid's one request (2026-10-12).
//
// All or nothing, per request: every row is checked first, and if any
// admission number is already taken, or repeated within the request, nothing
// is created and the 409 names each offending row by its index. The grid
// marks those rows and the admin resubmits. Placement in a class is not part
// of this request: the grid does not offer it (enrollment is its own step).

export const MAX_BULK_STUDENTS = 200;

export const bulkCreateStudentsSchema = z
  .object({
    students: z.array(createStudentSchema.omit({ enrollment: true })).min(1).max(MAX_BULK_STUDENTS),
  })
  .strict();

export type BulkCreateStudentsInput = z.infer<typeof bulkCreateStudentsSchema>;

/** Created students, in the order they were sent. */
export interface BulkCreateStudentsResponse {
  created: StudentDto[];
}

export const BULK_STUDENT_CONFLICT_CODE = "ADMISSION_NUMBERS_TAKEN";

/** `details` of the 409: which rows (index into `students`) and why. */
export interface BulkStudentConflictDetails {
  rows: { index: number; reason: "TAKEN" | "REPEATED_IN_REQUEST" }[];
}
