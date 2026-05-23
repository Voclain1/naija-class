import { z } from "zod";

// POST /class-levels — body schema for admin-created custom levels (the
// 14 default rows are seeded at signup; this endpoint exists so a school
// can add e.g. "Crèche" or "A-Levels" beyond the defaults).
//
// `code` is lowercase + digits + hyphens only, mirroring the seed's
// "kg1", "pri4" style, and is the stable per-school identifier backing
// the unique (school_id, code) index.
// `name` is the human-facing label, capped to a sane length to keep the
// table view tidy.
// `stage` matches the ClassStage enum.
// `orderIndex` is an integer >= 0; duplicates per school are tolerated
// (sort tie-breaks on name).
export const createClassLevelSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    code: z
      .string()
      .trim()
      .min(1)
      .max(16)
      .regex(/^[a-z0-9-]+$/, "Code must be lowercase letters, digits, and hyphens only"),
    stage: z.enum(["NURSERY", "PRIMARY", "JSS", "SSS"]),
    orderIndex: z.number().int().min(0).max(999),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateClassLevelInput = z.infer<typeof createClassLevelSchema>;
