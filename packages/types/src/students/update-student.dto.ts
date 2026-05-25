import { z } from "zod";

// PATCH /students/:id — every field optional, at least one required.
//
// `status` is reachable here but only as a direct write. The named
// transitions (withdraw / graduate / reactivate) use dedicated endpoints
// because they also set/clear *At timestamps — PATCHing status without
// those would leave the row in a half-consistent state.
//
// `admissionNumber` IS editable on update (e.g. a school typo-fixes a
// freshly-created row) — the unique constraint re-runs.
export const updateStudentSchema = z
  .object({
    admissionNumber: z.string().trim().min(1).max(40).optional(),
    firstName: z.string().trim().min(1).max(60).optional(),
    middleName: z.string().trim().min(1).max(60).nullable().optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    dateOfBirth: z.coerce.date().optional(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
    photoUrl: z.string().trim().url().max(500).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    bloodGroup: z.string().trim().min(1).max(10).nullable().optional(),
    medicalNotes: z.string().trim().min(1).max(2000).nullable().optional(),
    religion: z.string().trim().min(1).max(40).nullable().optional(),
    stateOfOrigin: z.string().trim().min(1).max(40).nullable().optional(),
    nationality: z.string().trim().min(1).max(40).optional(),
    status: z
      .enum(["ACTIVE", "INACTIVE", "WITHDRAWN", "GRADUATED", "SUSPENDED"])
      .optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;
