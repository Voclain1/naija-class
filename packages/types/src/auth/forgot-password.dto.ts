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
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// Always the same shape/message regardless of whether the email matched a
// real account — the account-enumeration guard is that this response never
// varies, not that the client can't parse it.
export interface ForgotPasswordResponse {
  message: string;
}
