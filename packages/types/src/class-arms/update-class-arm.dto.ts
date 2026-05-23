import { z } from "zod";

// PATCH /class-arms/:id — every field optional, at least one required.
// Moving an arm between class levels (changing classLevelId) is NOT
// supported in Phase 1: the unique (school_id, class_level_id, code)
// index would let it through, but enrollments would silently re-parent
// to a different level and the term-roster invariants would break. If a
// school needs that, create the arm under the new level and migrate
// enrollments — that's a future feature (likely a "promote arm" workflow
// in Phase 2's promotion engine).
export const updateClassArmSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only")
      .optional(),
    capacity: z.number().int().min(0).max(10_000).nullable().optional(),
    classTeacherId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateClassArmInput = z.infer<typeof updateClassArmSchema>;
