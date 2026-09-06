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

    /**
     * Place the student in a class in the same breath as creating them.
     *
     * OPTIONAL AT THE API, REQUIRED-CHOICE IN THE UI, and the difference is
     * deliberate. A school mid-admission legitimately holds students who are
     * not yet placed — `student-import-enrollment.md` D5 protects exactly that
     * state for the CSV path, and making this mandatory here would remove it
     * from the single-student path while leaving it available in bulk. What
     * the FORM does is force an explicit answer (an arm, or "place later"), so
     * nothing is guessed on the admin's behalf.
     *
     * There is deliberately NO default arm and NO default term. The 2026-08-25
     * carry-over incident was a pre-ticked default enrolling every student at a
     * newly-onboarded school, and the import path's D3 was overridden at review
     * for the same reason: "a silent default is most dangerous exactly when it
     * is most likely wrong".
     */
    enrollment: z
      .object({
        termId: z.string().uuid(),
        classArmId: z.string().uuid(),
      })
      .optional(),
  })
  .strict();

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
