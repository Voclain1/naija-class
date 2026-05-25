import { z } from "zod";

// POST /guardians — single create, no link. The link form
// (POST /students/:studentId/guardians/new) reuses these same field
// validations via a shared base — see link-guardian.dto.ts.
//
// Required: firstName, lastName, relationship, phone. Phone is required
// because guardians without a contact number are nearly useless to a
// school office; email is optional. occupation/employer/address/notes are
// all opt-in.

export const RELATIONSHIP_VALUES = [
  "FATHER",
  "MOTHER",
  "GUARDIAN",
  "UNCLE",
  "AUNT",
  "GRANDPARENT",
  "SIBLING",
  "OTHER",
] as const;

export const guardianFieldsSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  relationship: z.enum(RELATIONSHIP_VALUES),
  phone: z.string().trim().min(1).max(30),
  email: z.string().trim().email().max(254).nullable().optional(),
  occupation: z.string().trim().min(1).max(120).nullable().optional(),
  employer: z.string().trim().min(1).max(120).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  notes: z.string().trim().min(1).max(2000).nullable().optional(),
});

export const createGuardianSchema = guardianFieldsSchema.strict();

export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;
