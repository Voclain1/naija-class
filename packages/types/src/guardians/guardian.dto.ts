// Phase 1 / Slice 5 — Guardian + StudentGuardian DTOs returned by the API.
//
// Guardian is the second DTO carrying durable adult PII (Student was first).
// Every new field is a potential leak surface in logs, audit metadata, and
// Sentry payloads — the PII redactor
// (apps/api/src/observability/redact.ts) must list any sensitive key added
// here. Slice 5 adds `occupation` and `employer` to SENSITIVE_KEY_RE;
// firstName / lastName / address / phone / email are already masked by
// slice-4 rules.
//
// Parent AUTH is Phase 4 — Guardian has no User row paired with it yet, so
// the DTO does not expose any login-related fields.

export type RelationshipDto =
  | "FATHER"
  | "MOTHER"
  | "GUARDIAN"
  | "UNCLE"
  | "AUNT"
  | "GRANDPARENT"
  | "SIBLING"
  | "OTHER";

/**
 * Where this guardian stands with the parent portal, derived server-side from
 * the guardian row plus their invitation history (2026-09-16). Derived, never
 * stored: a stored copy would drift the moment an invitation expired, since
 * expiry is the passage of time rather than an event anything writes.
 *
 *   NO_EMAIL     — nothing can be sent; the invite action needs an email first.
 *   NOT_INVITED  — has an email, no invitation has ever been issued (or every
 *                  one was revoked).
 *   INVITED      — an invitation is live: not accepted, not revoked, not expired.
 *   EXPIRED      — the most recent live-ish invitation ran out unaccepted.
 *   ACTIVE       — the guardian has a password and can sign in.
 */
export type GuardianPortalStatusDto =
  | "NO_EMAIL"
  | "NOT_INVITED"
  | "INVITED"
  | "EXPIRED"
  | "ACTIVE";

export interface GuardianDto {
  id: string;
  firstName: string;
  lastName: string;
  relationship: RelationshipDto;
  phone: string;
  email: string | null;
  occupation: string | null;
  employer: string | null;
  address: string | null;
  notes: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  /** Portal standing (2026-09-16). Never a credential — a state name only. */
  portalStatus: GuardianPortalStatusDto;
  /** When the live invitation expires; set only when portalStatus is INVITED. */
  portalInvitationExpiresAt: string | Date | null;
}

// Detail view — Guardian plus the list of students currently linked. Mirrors
// the slice-4 StudentDetailDto pattern (Student plus linked guardians).
export interface GuardianDetailDto extends GuardianDto {
  students: GuardianStudentLinkDto[];
}

export interface GuardianStudentLinkDto {
  // The StudentGuardian link row id — what PATCH/DELETE /student-guardians/:id
  // targets. NOT the studentId itself.
  linkId: string;
  studentId: string;
  admissionNumber: string;
  firstName: string;
  lastName: string;
  isPrimary: boolean;
  canPickup: boolean;
}

// Cursor-paginated list response. Same shape as StudentListResponse — cursor
// is an opaque Guardian id, stable across edits because id never moves.
export interface GuardianListResponse {
  data: GuardianDto[];
  meta: {
    cursor?: string;
  };
}

// Returned by POST /students/:studentId/guardians and
// POST /students/:studentId/guardians/new — the freshly-created link plus
// (for the /new flow) the guardian it points at. Both flows return the same
// shape so the client can branch on `created` if it needs to refresh a
// guardian list elsewhere.
export interface CreateStudentGuardianLinkResponse {
  link: StudentGuardianLinkDto;
  guardian: GuardianDto;
  // true when /new created a fresh Guardian; false for the link-existing path.
  createdGuardian: boolean;
}

export interface StudentGuardianLinkDto {
  id: string;
  studentId: string;
  guardianId: string;
  isPrimary: boolean;
  canPickup: boolean;
  createdAt: string | Date;
}
