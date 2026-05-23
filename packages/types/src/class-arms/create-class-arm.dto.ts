import { z } from "zod";

// POST /class-levels/:levelId/class-arms — body schema. The parent
// classLevelId comes from the URL (nested-create convention from slice 1)
// so the body itself only carries the arm's own fields.
//
// `code` is the stable per-(school, level) identifier; the unique index
// is (school_id, class_level_id, code) so the same code can repeat across
// levels (e.g. "a" for both "jss1-a" and "jss2-a" would not — the code
// itself encodes the level in convention, but the constraint is on the
// triplet, not just the code).
// `capacity` is optional; null means "no cap tracked".
// `classTeacherId` is optional; service-layer validates the user exists
// in this tenant and has the `teacher` role.
export const createClassArmSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    code: z
      .string()
      .trim()
      .min(1)
      .max(20)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only"),
    capacity: z.number().int().min(0).max(10_000).nullable().optional(),
    classTeacherId: z.string().uuid().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateClassArmInput = z.infer<typeof createClassArmSchema>;
