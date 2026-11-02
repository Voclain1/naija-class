import { z } from "zod";

// Hidden subjects (2026-11-02, docs/modules/subjects-by-class.md).
//
// A hide takes a subject off a class's results without touching its scores:
// it shows on no report card, broadsheet, parents' or student app, or result
// checker, and counts in no total, average or position, while it applies.
//
// How wide: one class arm, a whole class level, or the whole school.
// How long: the term it was set in, that term's session (academic year), or
// until someone unhides it (from that term on, never earlier terms). A term or session hide simply stops applying
// afterwards; nothing has to run to end it.

export const SUBJECT_HIDE_SCOPES = ["ARM", "LEVEL", "SCHOOL"] as const;
export type SubjectHideScope = (typeof SUBJECT_HIDE_SCOPES)[number];

export const SUBJECT_HIDE_UNTIL = ["TERM", "YEAR", "INDEFINITE"] as const;
export type SubjectHideUntil = (typeof SUBJECT_HIDE_UNTIL)[number];

export const SUBJECT_HIDE_SCOPE_LABELS: Record<SubjectHideScope, string> = {
  ARM: "This class arm",
  LEVEL: "Every arm of this class",
  SCHOOL: "The whole school",
};

export const SUBJECT_HIDE_UNTIL_LABELS: Record<SubjectHideUntil, string> = {
  TERM: "This term only",
  YEAR: "This session",
  INDEFINITE: "Until I unhide it",
};

export const createSubjectHideSchema = z
  .object({
    subjectId: z.string().uuid(),
    termId: z.string().uuid(),
    scope: z.enum(SUBJECT_HIDE_SCOPES),
    classArmId: z.string().uuid().optional(),
    classLevelId: z.string().uuid().optional(),
    until: z.enum(SUBJECT_HIDE_UNTIL),
  })
  .strict()
  .refine((d) => (d.scope === "ARM" ? !!d.classArmId : true), {
    message: "Choose the class arm.",
    path: ["classArmId"],
  })
  .refine((d) => (d.scope === "LEVEL" ? !!d.classLevelId : true), {
    message: "Choose the class.",
    path: ["classLevelId"],
  });
export type CreateSubjectHideInput = z.infer<typeof createSubjectHideSchema>;

export const listSubjectHidesSchema = z.object({
  /** "true": only hides that apply now (not unhidden, term or session not over). */
  current: z.enum(["true", "false"]).optional(),
  classArmId: z.string().uuid().optional(),
});
export type ListSubjectHidesInput = z.infer<typeof listSubjectHidesSchema>;

export interface SubjectHideDto {
  id: string;
  subjectId: string;
  subjectName: string;
  scope: SubjectHideScope;
  classArmId: string | null;
  classArmName: string | null;
  classLevelId: string | null;
  classLevelName: string | null;
  until: SubjectHideUntil;
  termId: string;
  termName: string;
  academicYearLabel: string;
  hiddenByName: string | null;
  createdAt: string;
  unhiddenAt: string | null;
  /** Can the person asking unhide it (owner/admin, or the arm's form teacher for an arm hide). */
  canUnhide: boolean;
}

/** The fields of a hide that decide where and when it applies. */
export interface HideRule {
  scope: SubjectHideScope;
  classArmId: string | null;
  classLevelId: string | null;
  until: SubjectHideUntil;
  termId: string;
  academicYearId: string;
  /** Start of the term the hide was set in: an INDEFINITE hide applies from it onwards, never to earlier terms. */
  termStartDate: Date | string;
  unhiddenAt: Date | string | null;
}

/** Does this hide apply to results for this arm in this term? Pure, shared by every reader. */
export function hideApplies(
  hide: HideRule,
  at: { termId: string; academicYearId: string; termStartDate: Date | string; classArmId: string; classLevelId: string },
): boolean {
  if (hide.unhiddenAt) return false;
  if (hide.scope === "ARM" && hide.classArmId !== at.classArmId) return false;
  if (hide.scope === "LEVEL" && hide.classLevelId !== at.classLevelId) return false;
  if (hide.until === "TERM") return hide.termId === at.termId;
  if (hide.until === "YEAR") return hide.academicYearId === at.academicYearId;
  // INDEFINITE: the hide's own term and every later one, never results already out before it.
  return hide.termId === at.termId || new Date(at.termStartDate).getTime() >= new Date(hide.termStartDate).getTime();
}
