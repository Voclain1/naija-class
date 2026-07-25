import { z } from "zod";

// POST /auth/reset-password — PUBLIC.
//
// Password rules match signupOwnerSchema/acceptInvitationSchema exactly.
// Duplicated rather than imported — same rationale as
// invitations/accept-invitation.dto.ts: the constraints are short and the
// three schemas may drift independently as password policy evolves; each
// has its own unit-test coverage of the rule set.
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(1, "token is required"),
    password: z
      .string()
      .min(8, "password must be at least 8 characters")
      .max(128, "password must be at most 128 characters")
      .regex(/[A-Z]/, "password must contain at least one uppercase letter")
      .regex(/[a-z]/, "password must contain at least one lowercase letter")
      .regex(/[0-9]/, "password must contain at least one digit")
      .regex(/[^A-Za-z0-9]/, "password must contain at least one special character"),
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Deliberately NOT a session/token response (unlike AcceptInvitationResponse).
// Resetting a password does not auto-login — the client redirects to /login,
// which re-runs the normal 2FA-aware login flow rather than this endpoint
// re-implementing that branching. See auth.service.ts resetPassword() for
// the full rationale.
export interface ResetPasswordResponse {
  message: string;
}
