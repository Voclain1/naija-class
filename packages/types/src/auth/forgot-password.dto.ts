import { z } from "zod";

// POST /auth/forgot-password — PUBLIC.
//
// Intentionally lenient, same reasoning as loginSchema: this is the request
// that DECIDES whether an account exists, so the schema itself must not leak
// that (e.g. no `.refine()` doing an existence check here — that belongs to
// the service layer, which always returns the same generic response either
// way).
export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // The school's own address the person signed in at
  // (docs/modules/school-hosted-apps.md). When given, only an account at that
  // school is considered; absent (portal.schoolkit.ng, the apps), any school.
  schoolCode: z.string().trim().toLowerCase().min(1).max(63).optional(),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// Always the same shape/message regardless of whether the email matched a
// real account — the account-enumeration guard is that this response never
// varies, not that the client can't parse it.
export interface ForgotPasswordResponse {
  message: string;
}
