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
}

export interface BehaviourListResponse {
  data: BehaviourRecordDto[];
  /** Live counts, so a page can say "3 commendations, 1 concern" without maths. */
  commendations: number;
  concerns: number;
}

export const BEHAVIOUR_PERMISSIONS = ["behaviour.read", "behaviour.create"] as const;
