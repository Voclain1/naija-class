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
  // chance to see/copy the link. Resending rotates it: the previous token is
  // revoked in the same transaction, so exactly one link is ever live.
  acceptUrl: string;
}

// POST /guardians/:id/invite/resend (2026-09-16). Same shape as an invite —
// it IS an invite, preceded by revoking whatever was outstanding. `replaced`
// says whether there was one, so the UI can tell a resend from a first send
// without a second request.
export interface ResendGuardianInviteResponse extends InviteGuardianResponse {
  replaced: boolean;
}

// POST /guardians/:id/invite/revoke (2026-09-16). Cancels the live invitation
// without issuing another — for a wrong email address, or a parent who should
// no longer have access. Returns no URL: there is nothing left to hand out.
export interface RevokeGuardianInviteResponse {
  guardianId: string;
  revokedAt: string | Date;
}
