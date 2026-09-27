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
  /**
   * The school's own switchboard number, for "Call the school"
   * (docs/modules/the-school-day.md D12).
   *
   * The school's, never a person's: this is the number already printed on
   * their gate and their letterhead, not a teacher's mobile. Nullable because
   * a school can finish onboarding without one, and the button is HIDDEN
   * rather than dead when it is absent.
   */
  phone: string | null;
}

// No 2FA branch (unlike staff LoginResponse) — guardians have no TOTP
// enrollment in this slice.
export interface GuardianLoginResponse {
  guardian: GuardianLoginUserDto;
  school: GuardianLoginSchoolDto;
  token: string;
}
