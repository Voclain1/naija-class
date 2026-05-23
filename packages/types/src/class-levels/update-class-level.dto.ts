import { z } from "zod";

// PATCH /class-levels/:id — every field optional, at least one required.
// `code` is editable even though it's the stable identifier — schools that
// rename "kg1" → "creche" after rebranding can do so; the unique check
// re-runs at update time.
export const updateClassLevelSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only")
      .optional(),
    stage: z.enum(["NURSERY", "PRIMARY", "JSS", "SSS"]).optional(),
    orderIndex: z.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateClassLevelInput = z.infer<typeof updateClassLevelSchema>;
