import { z } from "zod";

// PATCH /subjects/:id — every field optional, at least one required. Same
// shape as updateClassLevelSchema. `code` is editable; the unique check
// re-runs at update time.
export const updateSubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only")
      .optional(),
    category: z.enum(["CORE", "ELECTIVE", "VOCATIONAL"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateSubjectInput = z.infer<typeof updateSubjectSchema>;
