import { z } from "zod";

// Owner invitations for a school provisioned from the platform-admin surface
// (POST /platform-admin/schools). Until these existed, an owner invitation
// that lapsed or went to a mistyped address could only be fixed in SQL — the
// explicit scope cut recorded when provisioning shipped (PR #149).
//
// POST /platform-admin/schools/:schoolId/owner-invitation/resend
//   Ends every open owner invitation for the school and sends a fresh one,
//   optionally to a corrected address. Refused once the school has an owner.
//
// POST /platform-admin/schools/:schoolId/owner-invitation/cancel
//   Ends every open owner invitation for the school without sending another.
//
// "Ends" = expires_at set to now. The row is kept (it is the record of what
// was sent), and a link already in someone's inbox then reads as expired.
export const platformAdminResendOwnerInvitationSchema = z.object({
  // Omit to resend to the address on the most recent owner invitation.
  ownerEmail: z.string().trim().toLowerCase().email().max(254).optional(),
});

export type PlatformAdminResendOwnerInvitationInput = z.infer<
  typeof platformAdminResendOwnerInvitationSchema
>;

export interface PlatformAdminResendOwnerInvitationResponse {
  schoolId: string;
  ownerEmail: string;
  invitationExpiresAt: string;
  // Same as provisioning's response: the link, so the operator can pass it on
  // by hand if the email does not arrive.
  acceptUrl: string;
}

export interface PlatformAdminCancelOwnerInvitationResponse {
  schoolId: string;
  // How many open invitations were ended. 0 means there was nothing to end.
  cancelledCount: number;
}
