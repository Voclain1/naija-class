import { z } from "zod";

import type { CurrentEnrollmentRefDto } from "../enrollments/enrollment.dto.js";

// Phase 6 / Slice 3 — the student principal.
//
// A student is the THIRD authenticated subject (staff User, Guardian,
// Student) and is modelled on Guardian, not on User: no role, no
// permissions (phase-6.md D17).

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

// POST /student-portal/login — PUBLIC.
//
// Identity is school slug + admission number (D20). NOT email: Student.email
// is nullable and non-unique, and most students do not have one. The pair
// (schools.slug, students.admission_number) is single-row by construction —
// slug is globally unique, and students carries UNIQUE(school_id,
// admission_number) — which is why this surface does NOT inherit the
// guardian login's multi-candidate argon2-verify loop.
//
// Password validation is deliberately LENIENT here (min 1), exactly as
// guardianLoginSchema is: enforcing policy at login would let an attacker
// probe policy compliance by comparing 400 against 401. Policy is enforced
// where the password is CHOSEN — acceptStudentInvitationSchema below.
export const studentLoginSchema = z.object({
  // Slugs are lowercase by construction (reserved-slugs.ts normalises before
  // checking). Normalising here too means a child typing "Test-School" is not
  // punished for capitalisation on a field they were handed on paper.
  schoolSlug: z.string().trim().toLowerCase().min(1, "school code is required").max(64),
  // Admission numbers are free text per school ("NJC/2025/001"), so the only
  // safe normalisation is trimming. Case is NOT folded — a school may
  // legitimately issue both "abc/1" and "ABC/1", and silently merging them
  // would be a cross-student collision.
  admissionNumber: z.string().trim().min(1, "admission number is required").max(64),
  password: z.string().min(1, "password is required").max(128),
});

export type StudentLoginInput = z.infer<typeof studentLoginSchema>;

export interface StudentPortalSchoolDto {
  id: string;
  name: string;
  slug: string;
}

export interface StudentPortalStudentDto {
  id: string;
  firstName: string;
  lastName: string;
  admissionNumber: string;
  // Resolved class placement, reusing the SAME DTO the guardian portal
  // already returns rather than declaring a narrower lookalike — a bare id
  // answers nothing when a student asks "which class am I in", and two
  // near-identical shapes for one concept is how they drift apart.
  currentEnrollment: CurrentEnrollmentRefDto | null;
}

// Mirrors GuardianLoginResponse's shape. Deliberately EXCLUDES date of birth,
// address, phone, email, blood group, medical notes and staff `notes` — a
// student has no product reason to read their own medical record here, and
// this payload is the one most likely to end up in an offline cache on a
// shared family handset.
export interface StudentLoginResponse {
  student: StudentPortalStudentDto;
  school: StudentPortalSchoolDto;
  token: string;
}

export type StudentMeResponse = Omit<StudentLoginResponse, "token">;

// ---------------------------------------------------------------------------
// Invitation (D26) — the single-use token a GUARDIAN issues for their child
// ---------------------------------------------------------------------------

// GET /student-portal/invitations/:token — PUBLIC.
//
// Deliberately carries NO student name. This endpoint takes an
// attacker-supplied token, so a name would turn a leaked or brute-forced
// token into a disclosure of which child it belongs to. The accept page says
// "your password"; the child knows who they are. `schoolName` is included
// because a child needs to know they are on the right school's page, and it
// is not personal data.
export interface PublicStudentInvitationDto {
  schoolName: string;
  expiresAt: string | Date;
}

// POST /student-portal/invitations/:token/accept — PUBLIC.
//
// This is where password policy is enforced (D24): minimum 8 characters, no
// composition rules. Composition rules produce "Password1!", not entropy, and
// a numeric PIN would be brute-forceable over an enumerable username space
// (phase-6.md §14.2 — admission numbers are sequential, school slugs public).
export const acceptStudentInvitationSchema = z.object({
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export type AcceptStudentInvitationInput = z.infer<typeof acceptStudentInvitationSchema>;

export type AcceptStudentInvitationResponse = StudentLoginResponse;

// ---------------------------------------------------------------------------
// Guardian-facing controls (on the existing /portal surface)
// ---------------------------------------------------------------------------

// Portal state is DERIVED from students.activated_at + students.password_hash
// (D25), never stored. A third column would be a second, divergeable copy of
// something audit_logs already records.
export const studentPortalStateValues = [
  "NEVER_ACTIVATED",
  "ACTIVE",
  "DEACTIVATED",
] as const;
export type StudentPortalState = (typeof studentPortalStateValues)[number];

export interface StudentPortalStatusDto {
  studentId: string;
  state: StudentPortalState;
  activatedAt: string | Date | null;
  lastLoginAt: string | Date | null;
  // Whether an unaccepted, unrevoked, unexpired invitation exists right now.
  // Lets the guardian UI say "invitation sent, not yet used" rather than
  // offering to send a second one that would silently revoke the first.
  hasPendingInvitation: boolean;
  pendingInvitationExpiresAt: string | Date | null;
}

// POST /portal/students/:id/portal-invitation
//
// The raw token is returned EXACTLY ONCE, in this response, and never stored
// — only its sha256 hash is persisted, the same contract as every session and
// invitation token in this codebase. The guardian hands the link to their
// child; if it is lost, they issue a new one (which revokes this one).
export interface IssueStudentInvitationResponse {
  invitationId: string;
  token: string;
  expiresAt: string | Date;
  // How many previously-outstanding invitations this one revoked. Surfaced so
  // the UI can say "your previous link no longer works" rather than leaving a
  // parent to wonder which link is live.
  revokedPrevious: number;
}

// POST /portal/students/:id/deactivate
export interface DeactivateStudentPortalResponse {
  studentId: string;
  state: StudentPortalState;
  // Both counts are surfaced deliberately: "did it actually take effect?"
  // should be answerable from the response, not inferred. They are also
  // written to the audit row.
  sessionsRevoked: number;
  invitationsRevoked: number;
}
