import { z } from "zod";

import { RELATIONSHIP_VALUES } from "./create-guardian.dto.js";

// PATCH /guardians/:id — every field optional, at least one required.
// Same shape rule as updateStudentSchema.
export const updateGuardianSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    relationship: z.enum(RELATIONSHIP_VALUES).optional(),
    phone: z.string().trim().min(1).max(30).optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    occupation: z.string().trim().min(1).max(120).nullable().optional(),
    employer: z.string().trim().min(1).max(120).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;
