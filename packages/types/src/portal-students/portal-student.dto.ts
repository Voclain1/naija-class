// Phase 4 / Slice 3 — guardian-facing student shape, returned by
// GET /portal/students and GET /portal/students/:id.
//
// Deliberately narrower than the admin-facing StudentDto (students/
// student.dto.ts): excludes notes, medicalNotes, religion, stateOfOrigin,
// address, phone, email, bloodGroup, nationality. Not a privacy boundary
// against the guardian themselves (a parent is entitled to their own
// child's data) — the exclusion is about not exposing internal
// admin-operational fields (e.g. `notes` may carry staff remarks never
// meant for parent eyes) on a "which child am I even looking at" list/
// detail primitive that has no product reason to need them yet. If a
// later slice's real child-detail screen needs some of these, that's a
// fresh, deliberate DTO decision at that slice's own plan-first, not
// inherited by default from this one.
//
// Reuses GenderDto/StudentStatusDto from the admin DTO rather than
// redeclaring the same string unions — avoids drift if a value is ever
// added to one and not the other.

import type { GenderDto, StudentStatusDto } from "../students/student.dto.js";
import type { CurrentEnrollmentRefDto } from "../enrollments/enrollment.dto.js";

export interface PortalStudentDto {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | Date;
  gender: GenderDto;
  photoUrl: string | null;
  status: StudentStatusDto;
  // From the StudentGuardian link row, not the Student row itself — this
  // guardian's own relationship to this specific child.
  isPrimary: boolean;
  canPickup: boolean;
  currentEnrollment: CurrentEnrollmentRefDto | null;
}

// No pagination — a guardian has a small, bounded number of linked
// children (not a roster-scale list), so a flat array is enough. Revisit
// if that assumption ever breaks.
export interface PortalStudentListResponse {
  data: PortalStudentDto[];
}
