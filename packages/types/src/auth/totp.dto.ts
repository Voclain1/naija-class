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
