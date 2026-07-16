import { z } from "zod";

import type { GuardianLoginResponse } from "./guardian-login.dto.js";

// GET /portal/invitations/:token — PUBLIC. Mirrors PublicInvitationDto
// (invitations/get-invitation.dto.ts) shape, minus roleKey (guardians have
// no RBAC role) and minus firstName/lastName/email pre-fill duplication —
// those come from the joined Guardian row via auth_resolve_guardian_
// invitation_by_token_hash, same fields, just guardian-flavoured naming.
export interface PublicGuardianInvitationDto {
  schoolName: string;
  schoolSlug: string;
  firstName: string;
  lastName: string;
  email: string | null;
  invitedByName: string;
  expiresAt: string | Date;
}

// POST /portal/invitations/:token/accept — PUBLIC. Password rules match
// acceptInvitationSchema (invitations/accept-invitation.dto.ts) exactly,
// duplicated rather than imported for the same independent-drift reason
// that file documents. No firstName/lastName fields — unlike a staff
// invitation accept (which creates a brand-new User), this sets
// passwordHash on the EXISTING Guardian row; name fields are already on it.
export const acceptGuardianInvitationSchema = z
  .object({
    password: z
      .string()
      .min(8, "password must be at least 8 characters")
      .max(128, "password must be at most 128 characters")
      .regex(/[A-Z]/, "password must contain at least one uppercase letter")
      .regex(/[a-z]/, "password must contain at least one lowercase letter")
      .regex(/[0-9]/, "password must contain at least one digit")
      .regex(/[^A-Za-z0-9]/, "password must contain at least one special character"),
    ndprConsent: z.literal(true, {
      errorMap: () => ({ message: "NDPR consent is required to accept an invitation" }),
    }),
  })
  .strict();

export type AcceptGuardianInvitationInput = z.infer<typeof acceptGuardianInvitationSchema>;

// Same shape as GuardianLoginResponse — accepting is "set password + log
// in" in one call, same precedent as staff AcceptInvitationResponse.
export type AcceptGuardianInvitationResponse = GuardianLoginResponse;
