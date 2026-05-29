// Phase 1 / Slice 4 — Student DTO shape returned by the API.
//
// First DTO carrying durable child PII. Read CLAUDE.md "Multi-tenancy"
// hard rules before adding new fields — every new field is potentially a
// new leak surface in logs, audit metadata, and Sentry payloads. The PII
// redactor (apps/api/src/observability/redact.ts) must list any sensitive
// key added here.
//
// Dates serialise as ISO strings over JSON; accept both `Date` and
// `string` to mirror every other Phase 1 DTO. `dateOfBirth` is a calendar
// date (no time-of-day) but the wire form is still ISO string — the API
// returns "2014-03-15T00:00:00.000Z" because Prisma maps DATE to JS Date.

import type { CurrentEnrollmentRefDto } from "../enrollments/enrollment.dto.js";

export type GenderDto = "MALE" | "FEMALE" | "OTHER";

export type StudentStatusDto =
  | "ACTIVE"
  | "INACTIVE"
  | "WITHDRAWN"
  | "GRADUATED"
  | "SUSPENDED";

export interface StudentDto {
  id: string;
  admissionNumber: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  dateOfBirth: string | Date;
  gender: GenderDto;
  photoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  bloodGroup: string | null;
  medicalNotes: string | null;
  religion: string | null;
  stateOfOrigin: string | null;
  nationality: string;
  status: StudentStatusDto;
  admittedAt: string | Date;
  withdrawnAt: string | Date | null;
  graduatedAt: string | Date | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  // Slice 9 addition: the student's enrollment in the school's CURRENT
  // term (the Term with isCurrent=true), or null if not enrolled this
  // term. The roster page reads this for the "Class" column without an
  // extra round-trip. Populated by StudentsService.list / findById via
  // a SINGLE batched query — see the slice 9 cp1 N+1 test.
  //
  // Methods that don't need the join (single-create response, status
  // transitions) leave it `undefined` — using `?` rather than `| null`
  // lets the API distinguish "didn't fetch" from "no enrollment".
  currentEnrollment?: CurrentEnrollmentRefDto | null;
}

// Detail view — slice 4 returns an empty guardians array; slice 5 populates
// it; slice 9 adds `currentEnrollment` (lifted to the base StudentDto for
// roster reuse, repeated here for documentation symmetry). Keeping the
// shape stable so the UI can render an "empty guardians" state today
// without a v2 endpoint later.
export interface StudentDetailDto extends StudentDto {
  guardians: StudentGuardianRefDto[];
}

export interface StudentGuardianRefDto {
  // The Guardian's id — links to /guardians/:id.
  id: string;
  // The StudentGuardian link row id — what PATCH/DELETE /student-guardians/:id
  // targets. Distinct from `id` because the UI needs both: `id` to navigate
  // to the guardian's own detail page; `linkId` to mutate this specific link.
  linkId: string;
  firstName: string;
  lastName: string;
  relationship: string;
  phone: string;
  isPrimary: boolean;
  canPickup: boolean;
}

// Cursor-paginated list response. Cursor is a Student id (opaque to the
// client) — stable across status changes because id never moves.
export interface StudentListResponse {
  data: StudentDto[];
  meta: {
    cursor?: string;
  };
}
