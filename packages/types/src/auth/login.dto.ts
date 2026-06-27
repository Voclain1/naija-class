import { z } from "zod";

import type { SignupOwnerSchoolDto, SignupOwnerUserDto } from "./signup-owner.dto.js";

// Login intentionally validates leniently. The signup schema enforces
// password complexity; login MUST NOT — otherwise an attacker could probe
// "is this account's password compliant with current policy?" by watching
// 400 vs 401 responses. Whatever the caller sends, if it doesn't match
// what is stored, the response is the same generic INVALID_CREDENTIALS.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "password is required").max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

// Discriminated union: when the user has 2FA enabled, login issues a
// short-lived challenge token instead of a session. The client must POST
// that token + a TOTP code to /auth/2fa/challenge to complete the flow.
// Both branches share the same HTTP 200 status; the client branches on
// `requiresTwoFactor`.
export type LoginResponse =
  | { requiresTwoFactor: false; user: SignupOwnerUserDto; school: SignupOwnerSchoolDto; token: string }
  | { requiresTwoFactor: true; challengeToken: string };
