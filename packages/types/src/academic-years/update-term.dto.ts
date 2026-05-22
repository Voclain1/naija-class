import { z } from "zod";

// PATCH /terms/:id — every field optional, at least one required.
export const updateTermSchema = z
  .object({
    sequence: z.number().int().min(1).max(3).optional(),
    name: z.string().trim().min(1).max(40).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  })
  .refine(
    (d) => d.startDate === undefined || d.endDate === undefined || d.endDate > d.startDate,
    { message: "endDate must be after startDate", path: ["endDate"] },
  );

export type UpdateTermInput = z.infer<typeof updateTermSchema>;
