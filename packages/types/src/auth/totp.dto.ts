import { z } from "zod";

import type { LoginResponse } from "./login.dto.js";

export interface TotpSetupResponseDto {
  otpAuthUrl: string;
  secret: string;
}

export const totpConfirmSchema = z.object({
  code: z.string().length(6, "code must be exactly 6 digits").regex(/^\d{6}$/, "code must be digits only"),
});
export type TotpConfirmInput = z.infer<typeof totpConfirmSchema>;

export const totpDisableSchema = z.object({
  currentPassword: z.string().min(1, "currentPassword is required"),
});
export type TotpDisableInput = z.infer<typeof totpDisableSchema>;

export interface TotpStatusDto {
  enabled: boolean;
}

// Submitted to POST /auth/2fa/challenge to complete a 2FA-gated login.
export const totpChallengeSchema = z.object({
  challengeToken: z.string().min(1, "challengeToken is required"),
  code: z.string().length(6, "code must be exactly 6 digits").regex(/^\d{6}$/, "code must be digits only"),
});
export type TotpChallengeInput = z.infer<typeof totpChallengeSchema>;

// The challenge endpoint always returns the non-2FA branch of LoginResponse
// (i.e. it issues a full session). Named explicitly so the web client can
// import the concrete type without narrowing.
export type TotpChallengeResponse = Extract<LoginResponse, { requiresTwoFactor: false }>;

// ---------------------------------------------------------------------------
// Opening the website from the app, already signed in
// (docs/modules/web-handoff-signin.md)
// ---------------------------------------------------------------------------

/**
 * `next` is a PATH, never a URL (H5). A handoff link that accepts a full URL
 * is an open redirect wearing the school's own domain.
 */
export const webHandoffSchema = z
  .object({
    next: z
      .string()
      .trim()
      .max(200)
      // A single leading slash (never "//host"), then ordinary path and
      // query characters. No scheme, no host, and ".." is refused below.
      .regex(/^\/(?!\/)[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/, "next must be a path on this site.")
      .refine((v) => !v.includes(".."), "next must not climb out of the site.")
      .optional(),
  })
  .strict();
export type WebHandoffInput = z.infer<typeof webHandoffSchema>;

export interface WebHandoffResponse {
  /** The one-time token. Returned once, never stored in the clear. */
  token: string;
  expiresAt: string | Date;
  /** Where the browser should land after the exchange. */
  next: string;
}

export const webHandoffExchangeSchema = z.object({ token: z.string().min(1) }).strict();
export type WebHandoffExchangeInput = z.infer<typeof webHandoffExchangeSchema>;
