import { z } from "zod";

// Phase 9 / CP3.1 — health profiles (docs/modules/phase-9.md §10).
//
// Who reads what (CP3-D1..D3):
//   - owner, admin and the Health officer: the whole profile;
//   - a teacher of the child: `teacherNote` ONLY, through its own shapes
//     below, which have no field for anything else;
//   - the child's guardians: the whole profile, read-only;
//   - the student's own portal: nothing.
// No AI anywhere near it.

export const HEALTH_LIMITS = {
  allergies: 1000,
  conditions: 2000,
  medication: 1000,
  gpClinic: 200,
  emergencyNotes: 1000,
  bloodGroup: 10,
  teacherNote: 500,
} as const;

export const HEALTH_PROFILE_FIELDS = [
  "allergies",
  "conditions",
  "medication",
  "gpClinic",
  "emergencyNotes",
  "bloodGroup",
  "teacherNote",
] as const;
export type HealthProfileField = (typeof HEALTH_PROFILE_FIELDS)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    // An emptied box clears the field rather than storing "".
    .transform((v) => (v === "" ? null : v));

/** Saving a profile: any field may be set or cleared. */
export const updateHealthProfileSchema = z
  .object({
    allergies: text(HEALTH_LIMITS.allergies),
    conditions: text(HEALTH_LIMITS.conditions),
    medication: text(HEALTH_LIMITS.medication),
    gpClinic: text(HEALTH_LIMITS.gpClinic),
    emergencyNotes: text(HEALTH_LIMITS.emergencyNotes),
    bloodGroup: text(HEALTH_LIMITS.bloodGroup),
    teacherNote: text(HEALTH_LIMITS.teacherNote),
  })
  .strict();
export type UpdateHealthProfileInput = z.input<typeof updateHealthProfileSchema>;

export interface HealthProfileFieldsDto {
  allergies: string | null;
  conditions: string | null;
  medication: string | null;
  gpClinic: string | null;
  emergencyNotes: string | null;
  bloodGroup: string | null;
  /** "For teachers": the only part a teacher of the child sees. */
  teacherNote: string | null;
}

/** Staff (owner, admin, Health officer). */
export interface HealthProfileDto extends HealthProfileFieldsDto {
  studentId: string;
  studentName: string;
  admissionNumber: string;
  className: string | null;
  updatedByName: string | null;
  /** Null when nothing has been recorded yet. */
  updatedAt: string | Date | null;
}

export const healthStudentListQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    armId: z.string().uuid().optional(),
  })
  .strict();
export type HealthStudentListQuery = z.infer<typeof healthStudentListQuerySchema>;

/** A row in the Health page's student list. Names and flags, no health text. */
export interface HealthStudentRowDto {
  studentId: string;
  name: string;
  admissionNumber: string;
  className: string | null;
  hasProfile: boolean;
  hasTeacherNote: boolean;
}

export interface HealthStudentListResponse {
  data: HealthStudentRowDto[];
  /** The classes to filter by. */
  arms: { id: string; name: string }[];
}

/** A teacher's view: the "For teachers" note and nothing else. */
export interface TeacherHealthNoteDto {
  studentId: string;
  name: string;
  note: string;
}

export interface TeacherHealthNotesResponse {
  data: TeacherHealthNoteDto[];
}

/** One child, for a teacher of theirs. `note` is null when none is shared. */
export interface TeacherHealthNoteForStudentDto {
  studentId: string;
  note: string | null;
}

/** A guardian's view of their own child. Read-only. */
export interface PortalHealthProfileDto extends HealthProfileFieldsDto {
  /** Null when the school has recorded nothing. */
  updatedAt: string | Date | null;
}
