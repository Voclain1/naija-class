import { z } from "zod";

import { guardianFieldsSchema } from "./create-guardian.dto.js";

// POST /students/:studentId/guardians — link an existing guardian to a
// student. `guardianId` required; `isPrimary` / `canPickup` optional with
// the same defaults as the DB column (false / true).
//
// isPrimary: true triggers an auto-demote of any other primary link for
// the same student in the same transaction. Spec defers schema-level
// uniqueness (a partial unique index would be the correct-by-construction
// guard but blocks demote-then-promote without DEFERRABLE) — service
// layer is the only enforcement path.
export const linkExistingGuardianSchema = z
  .object({
    guardianId: z.string().uuid(),
    isPrimary: z.boolean().optional(),
    canPickup: z.boolean().optional(),
  })
  .strict();

export type LinkExistingGuardianInput = z.infer<
  typeof linkExistingGuardianSchema
>;

// POST /students/:studentId/guardians/new — create a guardian and link it
// to the student in one transaction. Combines the full create-guardian
// payload with the link flags. Same auto-demote rule as link-existing.
export const createAndLinkGuardianSchema = guardianFieldsSchema
  .extend({
    isPrimary: z.boolean().optional(),
    canPickup: z.boolean().optional(),
  })
  .strict();

export type CreateAndLinkGuardianInput = z.infer<
  typeof createAndLinkGuardianSchema
>;

// PATCH /student-guardians/:id — toggle isPrimary / canPickup. At least
// one field required. isPrimary: true triggers the same demote rule.
export const updateStudentGuardianLinkSchema = z
  .object({
    isPrimary: z.boolean().optional(),
    canPickup: z.boolean().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, {
    message: "At least one field is required",
  });

export type UpdateStudentGuardianLinkInput = z.infer<
  typeof updateStudentGuardianLinkSchema
>;
