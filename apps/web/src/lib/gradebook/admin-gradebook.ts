import type {
  ClassArmDto,
  ClassLevelDto,
  SubjectDto,
  TeacherAssignmentDto,
  TermDto,
} from "@school-kit/types";

// The owner/admin gradebook (/gradebook) — pure selection rules.
//
// Owners and admins have always been allowed to enter scores for any class and
// subject (Phase 2 / Slice 2, Flag #1: "admins UNSCOPED"; assessment.service.ts
// isTeacherScoped). The teacher gradebook reads its picker from the teacher's
// own assignments, so it cannot serve them. These rules build the picker from
// the school's structure instead, and live here — not in the page — so the
// spec can pin them.

export interface GradebookArmOption {
  id: string;
  name: string;
}

export interface GradebookSubjectOption {
  id: string;
  name: string;
  /** An active teacher assignment covers this class and subject in the term. */
  hasTeacher: boolean;
}

/**
 * Active classes, in the school's level order and then by name. A class whose
 * level is unknown (not in `levels`) sorts after every known level.
 */
export function gradebookArms(arms: ClassArmDto[], levels: ClassLevelDto[]): GradebookArmOption[] {
  const order = new Map(levels.map((l) => [l.id, l.orderIndex]));
  return arms
    .filter((a) => a.isActive)
    .sort(
      (a, b) =>
        (order.get(a.classLevelId) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.classLevelId) ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name),
    )
    .map((a) => ({ id: a.id, name: a.name }));
}

/**
 * Whether an assignment applies to `term` — the same rule the completeness
 * report uses (phase-8.md D35): it names the term, or it names no term and
 * belongs to the term's academic year. Inactive assignments never apply.
 */
export function assignmentAppliesToTerm(assignment: TeacherAssignmentDto, term: TermDto): boolean {
  if (!assignment.isActive) return false;
  if (assignment.termId !== null) return assignment.termId === term.id;
  return assignment.academicYearId === term.academicYearId;
}

/**
 * Every active subject for one class (decision 1, approved 2026-09-15): a new
 * school has subjects but usually no class-subject links and no teachers, so
 * narrowing to either would recreate the dead end this page exists to remove.
 * Subjects a teacher is assigned to in this class and term come first, then
 * the rest; alphabetical within each group.
 */
export function gradebookSubjects(
  subjects: SubjectDto[],
  assignments: TeacherAssignmentDto[],
  armId: string,
  term: TermDto,
): GradebookSubjectOption[] {
  const taught = new Set(
    assignments
      .filter((a) => a.classArmId === armId && assignmentAppliesToTerm(a, term))
      .map((a) => a.subjectId),
  );
  return subjects
    .filter((s) => s.isActive)
    .map((s) => ({ id: s.id, name: s.name, hasTeacher: taught.has(s.id) }))
    .sort((a, b) => Number(b.hasTeacher) - Number(a.hasTeacher) || a.name.localeCompare(b.name));
}

/** The term to open by default: the current one, else the first listed. */
export function defaultGradebookTerm(terms: TermDto[]): TermDto | null {
  return terms.find((t) => t.isCurrent) ?? terms[0] ?? null;
}
