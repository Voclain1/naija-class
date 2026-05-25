import { z } from "zod";

// POST /students — single-create. Flat body; nested guardians arrive in
// slice 5. Required fields per phase-1.md: admissionNumber, firstName,
// lastName, dateOfBirth, gender. Every other field is optional.
//
// `dateOfBirth` accepts ISO date strings (YYYY-MM-DD) OR full ISO
// timestamps; coerced to Date because the DB column is DATE. `admittedAt`
// is an event-moment (defaults to now() if omitted) — full timestamp.
//
// `phone`, `email`, `photoUrl` are stored as-given in Phase 1 (no
// normalisation; Phase 4 communications will canonicalise). `admissionNumber`
// is free-text required-unique-per-school.
export const createStudentSchema = z
  .object({
    admissionNumber: z.string().trim().min(1).max(40),
    firstName: z.string().trim().min(1).max(60),
    middleName: z.string().trim().min(1).max(60).nullable().optional(),
    lastName: z.string().trim().min(1).max(60),
    dateOfBirth: z.coerce.date(),
    gender: z.enum(["MALE", "FEMALE", "OTHER"]),
    photoUrl: z.string().trim().url().max(500).nullable().optional(),
    address: z.string().trim().min(1).max(500).nullable().optional(),
    phone: z.string().trim().min(1).max(30).nullable().optional(),
    email: z.string().trim().email().max(254).nullable().optional(),
    bloodGroup: z.string().trim().min(1).max(10).nullable().optional(),
    medicalNotes: z.string().trim().min(1).max(2000).nullable().optional(),
    religion: z.string().trim().min(1).max(40).nullable().optional(),
    stateOfOrigin: z.string().trim().min(1).max(40).nullable().optional(),
    nationality: z.string().trim().min(1).max(40).optional(),
    admittedAt: z.coerce.date().optional(),
    notes: z.string().trim().min(1).max(2000).nullable().optional(),
  })
  .strict();

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
