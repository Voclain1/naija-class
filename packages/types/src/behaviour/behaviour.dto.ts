import { z } from "zod";

// Behaviour records (docs/modules/the-school-day.md Part C).
//
// C14: INTERNAL. There is no guardian or student DTO in this file, and that is
// the design rather than an omission — a note a parent can read changes what a
// teacher is willing to write, and "my child did not do that" needs a right of
// reply that does not exist yet.
//
// C15: no AI shape here either. Nothing is summarised, drafted or categorised
// by a model; a machine-written judgement about a child's conduct is not
// something a teacher can meaningfully approve.

export const BEHAVIOUR_KINDS = ["COMMENDATION", "CONCERN"] as const;
export type BehaviourKind = (typeof BEHAVIOUR_KINDS)[number];

export const BEHAVIOUR_NOTE_MAX = 1000;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That date does not exist.");

/**
 * Recording one.
 *
 * `occurredOn` is separate from when it was written: a teacher records
 * Friday's incident on Monday, and a record that quietly claims Monday is a
 * record nobody can rely on in a parent meeting.
 */
export const createBehaviourSchema = z
  .object({
    studentId: z.string().uuid(),
    kind: z.enum(BEHAVIOUR_KINDS),
    note: z.string().trim().min(1, "Write what happened.").max(BEHAVIOUR_NOTE_MAX),
    occurredOn: isoDate,
    // Phase 9 / CP2.1: optional, and refused unless the school has points on.
    // Its kind must match `kind`; its value is copied onto the record.
    categoryId: z.string().uuid().optional(),
  })
  .strict();
export type CreateBehaviourInput = z.infer<typeof createBehaviourSchema>;

export const behaviourListQuerySchema = z.object({ studentId: z.string().uuid() }).strict();
export type BehaviourListQuery = z.infer<typeof behaviourListQuerySchema>;

export interface BehaviourRecordDto {
  id: string;
  studentId: string;
  kind: BehaviourKind;
  note: string;
  occurredOn: string;
  /** Who wrote it. Staff-only surface, so the name is the accountability. */
  recordedByName: string | null;
  createdAt: string | Date;
  withdrawnAt: string | Date | null;
  /** Phase 9 / CP2.1. Null when the record has no category. */
  categoryName: string | null;
  /** The value copied from the category when the record was written. */
  points: number | null;
  /** Phase 9 / CP2.2. Set when the record is one student's part of an incident. */
  incident: { id: string; place: string } | null;
}

export interface BehaviourListResponse {
  data: BehaviourRecordDto[];
  /** Live counts, so a page can say "3 commendations, 1 concern" without maths. */
  commendations: number;
  concerns: number;
  /**
   * Phase 9 / CP2.1: the sum of live records' points dated inside the current
   * term. Null when the school has points off or there is no current term.
   */
  termPoints: number | null;
}

export const BEHAVIOUR_PERMISSIONS = ["behaviour.read", "behaviour.create"] as const;

// ---------------------------------------------------------------------------
// Phase 9 / CP2.1 — points and categories (docs/modules/phase-9.md §9 CP2-D1)
// ---------------------------------------------------------------------------

export const BEHAVIOUR_CATEGORY_NAME_MAX = 60;
export const BEHAVIOUR_POINTS_MAX = 10;

const categoryName = z
  .string()
  .trim()
  .min(1, "Give the category a name.")
  .max(BEHAVIOUR_CATEGORY_NAME_MAX, `Keep the name to ${BEHAVIOUR_CATEGORY_NAME_MAX} characters.`);

/** A commendation scores 1…10, a concern −10…−1. The sign follows the kind. */
const pointsFor = (kind: BehaviourKind, points: number): boolean =>
  kind === "COMMENDATION" ? points >= 1 && points <= BEHAVIOUR_POINTS_MAX : points <= -1 && points >= -BEHAVIOUR_POINTS_MAX;

export const createBehaviourCategorySchema = z
  .object({
    name: categoryName,
    kind: z.enum(BEHAVIOUR_KINDS),
    points: z.number().int(),
  })
  .strict()
  .refine((value) => pointsFor(value.kind, value.points), {
    message: "A commendation scores 1 to 10 points, a concern −1 to −10.",
    path: ["points"],
  });
export type CreateBehaviourCategoryInput = z.infer<typeof createBehaviourCategorySchema>;

/** The kind cannot change: it would flip the sign of every past record's category. */
export const updateBehaviourCategorySchema = z
  .object({
    name: categoryName.optional(),
    points: z.number().int().min(-BEHAVIOUR_POINTS_MAX).max(BEHAVIOUR_POINTS_MAX).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change.");
export type UpdateBehaviourCategoryInput = z.infer<typeof updateBehaviourCategorySchema>;

export const updateBehaviourSettingsSchema = z.object({ pointsEnabled: z.boolean() }).strict();
export type UpdateBehaviourSettingsInput = z.infer<typeof updateBehaviourSettingsSchema>;

export interface BehaviourCategoryDto {
  id: string;
  name: string;
  kind: BehaviourKind;
  points: number;
  active: boolean;
}

/** What a writer needs to offer categories, and what Settings shows. */
export interface BehaviourSettingsDto {
  pointsEnabled: boolean;
  categories: BehaviourCategoryDto[];
}

// ---------------------------------------------------------------------------
// Phase 9 / CP2.2 — incidents (docs/modules/phase-9.md §9 CP2-D2)
// ---------------------------------------------------------------------------

export const BEHAVIOUR_INCIDENT_PLACE_MAX = 120;
export const BEHAVIOUR_INCIDENT_MAX_STUDENTS = 30;
export const BEHAVIOUR_INCIDENT_MAX_WITNESSES = 10;

/**
 * Recording an incident. Each student gets a CONCERN record linked to it.
 * A student's own note is optional; without one, their record carries the
 * incident's description. One category, if chosen, applies to every student.
 */
export const createBehaviourIncidentSchema = z
  .object({
    occurredOn: isoDate,
    place: z.string().trim().min(1, "Say where it happened.").max(BEHAVIOUR_INCIDENT_PLACE_MAX),
    description: z.string().trim().min(1, "Describe what happened.").max(BEHAVIOUR_NOTE_MAX),
    students: z
      .array(
        z
          .object({
            studentId: z.string().uuid(),
            note: z.string().trim().max(BEHAVIOUR_NOTE_MAX).optional(),
          })
          .strict(),
      )
      .min(1, "Choose at least one student.")
      .max(BEHAVIOUR_INCIDENT_MAX_STUDENTS)
      .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, "A student is listed twice."),
    witnessIds: z
      .array(z.string().uuid())
      .max(BEHAVIOUR_INCIDENT_MAX_WITNESSES)
      .refine((ids) => new Set(ids).size === ids.length, "A witness is listed twice.")
      .default([]),
    categoryId: z.string().uuid().optional(),
  })
  .strict();
export type CreateBehaviourIncidentInput = z.input<typeof createBehaviourIncidentSchema>;

export const behaviourIncidentListQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict();
export type BehaviourIncidentListQuery = z.infer<typeof behaviourIncidentListQuerySchema>;

export interface BehaviourIncidentStudentDto {
  studentId: string;
  name: string;
  /** The student's record in this incident. */
  recordId: string;
  note: string;
}

export interface BehaviourIncidentDto {
  id: string;
  occurredOn: string;
  place: string;
  description: string;
  recordedByName: string | null;
  createdAt: string | Date;
  withdrawnAt: string | Date | null;
  students: BehaviourIncidentStudentDto[];
  witnesses: { userId: string; name: string }[];
  /** Whether the viewer may withdraw it: the person who recorded it, or an admin. */
  canWithdraw: boolean;
}

export interface BehaviourIncidentListResponse {
  data: BehaviourIncidentDto[];
}

/**
 * What the incident form offers: the classes the viewer may name students
 * from (all of them for an owner or admin, their own for a teacher) and the
 * staff who can be named as witnesses. Names only.
 */
export interface BehaviourIncidentOptionsDto {
  arms: { id: string; name: string }[];
  staff: { userId: string; name: string }[];
}

export interface BehaviourIncidentRosterDto {
  students: { studentId: string; name: string }[];
}
