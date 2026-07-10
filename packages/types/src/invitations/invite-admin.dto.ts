import { z } from "zod";

// POST /users/invite — owner or admin invites a new admin OR bursar to their
// school. Originally admin-only (Phase 0); Phase 3 slice 15 added the
// roleKey field so a single admin/bursar invite can be sent from the UI
// instead of only via the admin-only default. Teacher invites still go
// through the bulk CSV import (docs/deferred.md tracks the separate,
// still-open "single teacher invite" gap — a different trigger, since
// TeacherProfile fields aren't on this path).
//
// roleKey is a closed enum, not a free-text string — UsersService.invite
// still re-validates it server-side rather than trusting the client/Zod
// alone (never trust a client-supplied role without allow-listing).
// Deliberately excludes "owner" (there is exactly one per school, minted at
// signup) and "teacher" (see above).
//
// firstName / lastName are optional pre-fill values shown on the accept page.
// The invitee can edit them before submitting, so we don't enforce them at
// invite time — but we do cap length so a paste of a paragraph can't blow
// up the form rendering.
export const inviteAdminSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    firstName: z.string().trim().min(1).max(60).optional(),
    lastName: z.string().trim().min(1).max(60).optional(),
    roleKey: z.enum(["admin", "bursar"]).default("admin"),
  })
  .strict();

// z.input (not z.infer/z.output): keeps roleKey optional in the TS type seen
// by callers that construct this object directly (tests, direct service
// calls, the web form) rather than through the Zod parse/pipe — the same
// shape the pre-slice-15 callers already used. UsersService.invite defaults
// a missing roleKey to "admin" itself, so behaviour is identical whether or
// not the value passed through inviteAdminSchema.parse() first.
export type InviteAdminInput = z.input<typeof inviteAdminSchema>;

// Response shape. Carries the raw token so the admin UI can build a "Copy
// invite link" affordance immediately after creation — email delivery via
// Resend is deferred to Phase 4, so the dev story is copy-paste.
//
// The token is a one-time secret. Once this response is consumed and the
// page navigates away, the raw token is lost — the DB only has the hash.
// That's by design: re-issuing requires creating a fresh invitation.
export interface InvitationCreatedDto {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roleKey: string;
  expiresAt: string | Date;
  createdAt: string | Date;
}

export interface InviteAdminResponse {
  invitation: InvitationCreatedDto;
  token: string;
  acceptUrl: string;
}
