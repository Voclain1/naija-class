import { z } from "zod";

// PATCH /class-subjects/:id — only `isCore` is editable in-place.
// Re-parenting (classLevelId / subjectId) is a delete+create, not an
// update; modelling those as updates would silently break the unique
// (school_id, class_level_id, subject_id) constraint's semantics.
//
// Spec note: docs/modules/phase-1.md → Permission strings (line 1018) lists
// `class-subject.read/create/delete` but not `class-subject.update`. We
// add the update permission and endpoint here so the matrix UI can toggle
// core/elective without a delete+create round-trip — flagged as a slice-3
// reconciliation against the original spec prose.
export const updateClassSubjectSchema = z
  .object({
    isCore: z.boolean(),
  })
  .strict();

export type UpdateClassSubjectInput = z.infer<typeof updateClassSubjectSchema>;
