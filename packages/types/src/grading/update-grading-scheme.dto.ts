import { z } from "zod";

// PATCH /grading-scheme — rename the school's single scheme and/or toggle
// isActive. Both fields optional; `.strict()` rejects unknown keys. At least
// one field must be present so a no-op PATCH is a client error rather than a
// silent success.
export const updateGradingSchemeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((d) => d.name !== undefined || d.isActive !== undefined, {
    message: "Provide at least one field to update.",
    path: ["name"],
  });

export type UpdateGradingSchemeInput = z.infer<typeof updateGradingSchemeSchema>;
