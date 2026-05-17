// GET /invitations/:token — PUBLIC endpoint, no auth required.
//
// Returns only what the accept page needs to render:
//   - schoolName, schoolSlug      → headline "Join {schoolName} as admin"
//   - roleKey                     → label the role being offered
//   - email                       → shown read-only on the form so the
//                                   invitee sees which address this is for
//   - firstName, lastName         → pre-fill values for the form
//   - invitedByName               → "Invited by Jane Doe" line
//   - expiresAt                   → relative-time "Expires in 7 days"
//
// DELIBERATELY OMITTED:
//   - schoolId, invitationId       — opaque ids that a public viewer
//     should not see; the accept call uses the token, not the id.
//   - inviter user id / email      — internal to the issuing school.
//   - tokenHash                    — never returned to anyone.
//   - acceptedAt                   — if non-null we 410 before returning a
//     DTO; the field would be meaningless on the wire.
export interface PublicInvitationDto {
  schoolName: string;
  schoolSlug: string;
  roleKey: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  invitedByName: string;
  expiresAt: string | Date;
}
