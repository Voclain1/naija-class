import { z } from "zod";

// POST /class-levels/:levelId/class-subjects — body schema. The parent
// classLevelId comes from the URL (nested-create convention). The body
// references the subject to link and the core/elective flag.
export const createClassSubjectSchema = z
  .object({
    subjectId: z.string().uuid(),
    isCore: z.boolean().optional(),
  })
  .strict();

export type CreateClassSubjectInput = z.infer<typeof createClassSubjectSchema>;
