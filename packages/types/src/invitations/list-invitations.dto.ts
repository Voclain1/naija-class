// GET /users/invitations — owner/admin only. Lists pending invitations for
// the current school (not yet accepted AND not yet expired). Expired or
// accepted invitations are filtered out at the service layer rather than
// returned with a status flag — the page only ever wants the actionable set.
//
// invitedBy is denormalised into a small nested object so the table can
// render "Invited by Jane Doe" without a second round trip. The id is
// included so a future "view this admin's other invitations" affordance has
// a stable handle.
export interface InvitationInviterDto {
  id: string;
  firstName: string;
  lastName: string;
}

export interface PendingInvitationDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleKey: string;
  invitedBy: InvitationInviterDto;
  expiresAt: string | Date;
  createdAt: string | Date;
}
