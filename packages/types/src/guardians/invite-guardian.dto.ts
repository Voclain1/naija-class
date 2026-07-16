// Phase 4 / Slice 2 — POST /guardians/:id/invite. No request body: the
// guardian's email is already on the row (must be non-null — the service
// rejects otherwise), and there is nothing else for an admin to submit.
// Returns just enough for the admin UI to confirm the action and show the
// accept link the same way UsersService.invite's console-log + admin-UI
// pattern does for staff (Resend delivery is deferred — docs/deferred.md).
export interface InviteGuardianResponse {
  guardianId: string;
  portalInvitedAt: string | Date;
  // The accept URL, built the same way UsersService.invite builds staff
  // accept links (`${webBaseUrl()}/invitations/${rawToken}` there; here
  // it points at the portal's own accept-invite page). Present ONLY in this
  // response — the raw token is never stored, so this is the one and only
  // chance to see/copy the link. Re-inviting rotates it (see docs/deferred.md
  // "Re-issue / revoke pending invitations" — same known limitation as staff).
  acceptUrl: string;
}
