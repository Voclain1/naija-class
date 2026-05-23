// Phase 1 / Slice 3 — ClassSubject DTO shape returned by the API.
//
// ClassSubject is the explicit join between ClassLevel and Subject —
// curriculum lives at the level, not the arm (all arms of JSS 1 take the
// same set of subjects). `isCore` is the only payload bit: schools may
// flip a subject's core/elective status per level (e.g. Maths is core in
// JSS, elective in some SSS streams).

export interface ClassSubjectDto {
  id: string;
  classLevelId: string;
  subjectId: string;
  isCore: boolean;
  createdAt: string | Date;
}
