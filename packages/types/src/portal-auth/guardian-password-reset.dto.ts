import { z } from "zod";

// Guardian portal password recovery — POST /portal/forgot-password and
// POST /portal/reset-password. Both PUBLIC: a guardian who has forgotten
// their password has no session by definition.
//
// These are DELIBERATELY separate schemas from auth/forgot-password.dto.ts
// and auth/reset-password.dto.ts rather than shared imports, for the same
// reason acceptGuardianInvitationSchema does not reuse the staff one: the
// two auth surfaces are architecturally separate (separate tables, separate
// sessions, separate guards — see ARCHITECTURE.md §12), and coupling their
// request contracts would mean a change to staff password policy silently
// changing guardian policy too. The password rules below are identical to
// the staff ones TODAY, and that is a fact about today, not a constraint.

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

// Intentionally lenient, same reasoning as guardianLoginSchema: this is the
// request that DECIDES whether an account exists, so the schema itself must
// not leak that. No existence check here — the service always returns the
// same generic response either way.
export const guardianForgotPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
  })
  .strict();

export type GuardianForgotPasswordInput = z.infer<typeof guardianForgotPasswordSchema>;

/**
 * Always the same shape and message regardless of whether the email matched
 * anything — the account-enumeration guard is that this response NEVER
 * varies.
 *
 * Note the extra wrinkle guardians have and staff do not: `Guardian.email` is
 * unique only per SCHOOL (Decision C, phase-4.md), so one email address can
 * legitimately own portal accounts at several schools. The service issues one
 * token per matching account and sends one email per account, each naming its
 * school. That detail reaches only the inbox owner — who already owns every
 * one of those accounts — so it is not an enumeration leak. The HTTP response
 * still says nothing.
 */
export interface GuardianForgotPasswordResponse {
  message: string;
}

// ---------------------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------------------

export const guardianResetPasswordSchema = z
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

export type GuardianResetPasswordInput = z.infer<typeof guardianResetPasswordSchema>;

/**
 * Deliberately NOT a session/token response — resetting does not auto-login.
 *
 * This follows the staff convention (ResetPasswordResponse) rather than the
 * invitation-accept convention (which DOES return a token). The reasoning
 * transfers exactly: an invitation-accept is a first-time enrolment where the
 * holder of the link is establishing the account, whereas a reset is a
 * recovery on an existing account and should re-enter the normal, fully
 * rate-limited login path. It also means a leaked reset link cannot be turned
 * straight into a live session without the new password being typed at the
 * login form.
 */
export interface GuardianResetPasswordResponse {
  message: string;
}
