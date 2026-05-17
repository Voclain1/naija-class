import { z } from "zod";

// POST /users/invite — owner or admin invites a new admin to their school.
// Phase 0 is admin-only because that's the only role with a real permission
// set. Other role keys join later phases (teacher in Phase 2, etc.) and will
// likely arrive via different endpoints with their own validation.
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
  })
  .strict();

export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;

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
