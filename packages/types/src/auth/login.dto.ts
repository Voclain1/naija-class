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

// Login response is shape-compatible with the signup response so the
// client can treat both flows identically (store token, refresh user
// state). The DTO types from signup-owner.dto.ts are reused verbatim.
export interface LoginResponse {
  user: SignupOwnerUserDto;
  school: SignupOwnerSchoolDto;
  token: string;
}
