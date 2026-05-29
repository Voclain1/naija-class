// Phase 1 / Slice 9 — Enrollment DTO + supporting shapes.
//
// EnrollmentDto is the canonical response shape across single-fetch,
// list, and update endpoints. CurrentEnrollmentRefDto is the trimmed
// shape used in two narrower contexts:
//   - Embedded on StudentDto for the roster page's "current arm" column
//     (slice 4 stubbed an empty placeholder; slice 9 populates it)
//   - Embedded on StudentDetailDto via the `currentEnrollment` field
//
// Dates serialise as ISO strings over JSON; accept both Date and string
// to mirror every other Phase 1 DTO.

export type EnrollmentStatusDto =
  | "ENROLLED"
  | "TRANSFERRED"
  | "PROMOTED"
  | "REPEATED"
  | "WITHDRAWN"
  | "GRADUATED";

export interface EnrollmentDto {
  id: string;
  studentId: string;
  termId: string;
  academicYearId: string;
  classArmId: string;
  status: EnrollmentStatusDto;
  enrolledAt: string | Date;
  transferredAt: string | Date | null;
  withdrawnAt: string | Date | null;
  promotedFromArmId: string | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// Trimmed shape for embedding on Student responses. Carries the
// human-facing labels so the roster page can render "JSS 1A · Term 1"
// without a second round-trip. The classLevel block is denormalised
// from classArm.classLevel — same query, same join — exposed here so
// the UI can group by level if it wants to.
export interface CurrentEnrollmentRefDto {
  id: string;
  status: EnrollmentStatusDto;
  classArm: {
    id: string;
    name: string;
    classLevel: {
      id: string;
      name: string;
    };
  };
  term: {
    id: string;
    name: string;
    sequence: number;
  };
  academicYearId: string;
}

// Cursor-paginated list response. Same shape as Phase 1's other list
// responses (academic-years, students, guardians).
export interface EnrollmentListResponse {
  data: EnrollmentDto[];
  meta: {
    cursor?: string;
  };
}

// Response for POST /enrollments/bulk. Per-row outcomes so the wizard
// can show the admin a breakdown ("X carried over, Y skipped because
// already enrolled, Z failed because student withdrawn"). Slice 7's
// commit-handler shape gave us the per-row error pattern; we reuse
// the same idea here.
export interface BulkEnrollmentResponse {
  created: number;
  skipped: number; // already enrolled in this term (idempotent re-run)
  errors: Array<{
    studentId: string;
    reason: string;
  }>;
}
