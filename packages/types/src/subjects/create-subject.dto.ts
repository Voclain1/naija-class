import { z } from "zod";

// POST /subjects — body schema. Subject is a school-wide catalogue entry;
// admins add e.g. "Mathematics", "Civic Education" once and then link to
// one or more ClassLevels via class_subjects.
//
// `code` is the stable per-school identifier backing the unique
// (school_id, code) index — lowercase letters, digits, hyphens only.
// `category` defaults to CORE because the typical Nigerian subject is
// core; admin can flip later via PATCH.
export const createSubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only"),
    category: z.enum(["CORE", "ELECTIVE", "VOCATIONAL"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateSubjectInput = z.infer<typeof createSubjectSchema>;
