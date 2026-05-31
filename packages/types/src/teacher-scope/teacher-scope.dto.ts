// Phase 1 / Slice 11 cp2 — teacher-scope read DTOs.
//
// These back the dedicated, scope-filtered teacher endpoints (Q3a: teachers
// hit ONLY /teacher-scope/* — admin CRUD stays owner|admin and rejects
// teachers). The scope object is the authorization boundary the cp3 portal
// renders against: it tells the teacher which arms they may open and which
// subjects they teach in each.

import type { GenderDto, StudentStatusDto } from "../students/student.dto.js";

// A class arm in the teacher's scope — id + display fields so cp3 can render
// "JSS 1A" directly without a second lookup. `code` is the stable per-(school,
// level) identifier; `name` is the human label.
export interface TeacherScopeArmDto {
  id: string;
  name: string;
  code: string;
}

// A subject the teacher teaches in a given arm — same id + display fields.
export interface TeacherScopeSubjectDto {
  id: string;
  name: string;
  code: string;
}

// The teacher's scope: which class arms they may see, and which subjects they
// teach in each. `classArms` is the UNION of subject-assignment arms
// (TeacherAssignment) and homeroom arms (ClassArm.classTeacherId) — a form
// teacher sees their arm even if they teach no subject in it, so a homeroom-
// only arm appears in `classArms` with NO entry in `subjectsByArm`.
//
// Enriched in cp2 (from ids-only) so the cp3 portal renders arm + subject
// names from ONE round-trip instead of three. The names + codes are NOT
// sensitive — they are class-level identifiers exposed by every admin
// endpoint, not student PII. (Student PII stays narrow on the roster — see
// TeacherRosterStudentDto.)
//
// subjectsByArm is a plain object on the wire (the helper builds a Map; the
// service converts to Record<armId, TeacherScopeSubjectDto[]>).
export interface TeacherScopeDto {
  classArms: TeacherScopeArmDto[];
  subjectsByArm: Record<string, TeacherScopeSubjectDto[]>;
}

// Trimmed roster row for the per-arm student list. Deliberately a SUBSET of
// StudentDto: a class register needs to identify students (name, admission
// number, gender, photo, status), NOT their medical notes, home address,
// contact details, or date of birth. Minimising the PII a teacher endpoint
// returns is the security posture CLAUDE.md mandates — see the cp2 divergence
// note in docs/journal/2026-05-31.
export interface TeacherRosterStudentDto {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  gender: GenderDto;
  photoUrl: string | null;
  status: StudentStatusDto;
}

export interface TeacherRosterResponse {
  data: TeacherRosterStudentDto[];
}
