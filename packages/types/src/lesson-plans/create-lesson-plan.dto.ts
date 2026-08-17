import { z } from "zod";

// POST /lesson-plans — creates the row AND runs the generation.
//
// Topic bounds: 3 chars stops a stray keystroke burning a Sonnet call; 200 is
// generous for a real topic while bounding the reservation estimate. These are
// the only guard against a teacher pasting an essay (or a student record) into
// the topic field — the prompt renderer deliberately passes free text through
// verbatim, so the limit belongs here, at the API boundary.
export const createLessonPlanSchema = z
  .object({
    classLevelId: z.string().uuid(),
    subjectId: z.string().uuid(),
    topic: z.string().trim().min(3).max(200),
    objectives: z.string().trim().max(2000).optional().nullable(),
    // Nigerian secondary periods are typically 35-80 minutes; the bounds are
    // loose enough for a double period, tight enough to catch a typo'd 400.
    durationMinutes: z.number().int().min(5).max(240).optional().nullable(),
  })
  .strict();

export type CreateLessonPlanInput = z.infer<typeof createLessonPlanSchema>;

// PATCH /lesson-plans/:id — the teacher's own edits to generated content.
// Every field optional: the UI saves one section at a time (the columns are
// separate precisely so a per-section save is not a read-modify-write race).
export const updateLessonPlanSchema = z
  .object({
    topic: z.string().trim().min(3).max(200).optional(),
    objectives: z.string().trim().max(2000).nullable().optional(),
    durationMinutes: z.number().int().min(5).max(240).nullable().optional(),
    behaviouralObjectives: z.string().max(20000).nullable().optional(),
    instructionalMaterials: z.string().max(20000).nullable().optional(),
    previousKnowledge: z.string().max(20000).nullable().optional(),
    referenceMaterials: z.string().max(20000).nullable().optional(),
    mainContent: z.string().max(20000).nullable().optional(),
    assessment: z.string().max(20000).nullable().optional(),
    homework: z.string().max(20000).nullable().optional(),
    conclusion: z.string().max(20000).nullable().optional(),
    quiz: z.string().max(20000).nullable().optional(),
    // Legacy pre-v2 sections stay editable so a teacher can still fix a typo
    // in an old lesson note; new generations never populate them.
    introduction: z.string().max(20000).nullable().optional(),
    activities: z.string().max(20000).nullable().optional(),
    status: z.enum(["DRAFT", "ACCEPTED"]).optional(),
  })
  .strict();

export type UpdateLessonPlanInput = z.infer<typeof updateLessonPlanSchema>;

// GET /lesson-plans — teacher-facing list filters.
export const listLessonPlansSchema = z
  .object({
    classLevelId: z.string().uuid().optional(),
    subjectId: z.string().uuid().optional(),
    // Defaults to the caller's own plans; admins can widen it.
    mine: z.coerce.boolean().optional(),
  })
  .strict();

export type ListLessonPlansInput = z.infer<typeof listLessonPlansSchema>;
