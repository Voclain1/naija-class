import { z } from "zod";

// POST /portal/login — PUBLIC. Same leniency rationale as loginSchema
// (auth/login.dto.ts): validating password complexity here would let an
// attacker probe policy compliance via 400-vs-401. Whatever the caller
// sends, a mismatch against the stored hash is the same generic
// INVALID_CREDENTIALS either way.
export const guardianLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "password is required").max(128),
});

export type GuardianLoginInput = z.infer<typeof guardianLoginSchema>;

export interface GuardianLoginUserDto {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface GuardianLoginSchoolDto {
  id: string;
  name: string;
  slug: string;
}

// No 2FA branch (unlike staff LoginResponse) — guardians have no TOTP
// enrollment in this slice.
export interface GuardianLoginResponse {
  guardian: GuardianLoginUserDto;
  school: GuardianLoginSchoolDto;
  token: string;
}
