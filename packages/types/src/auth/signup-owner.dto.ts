import { z } from "zod";
import { RESERVED_SLUGS } from "./reserved-slugs.js";

// Slug rules: lowercase letters, digits, hyphens. 3–40 chars. Cannot start or
// end with a hyphen. Becomes a subdomain (<slug>.schoolkit.ng).
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

// Phone: tolerant E.164-ish. Permits a leading + and 10–15 digits.
// Real validation (country code, MNO prefix for Nigeria) lives in Phase 3.
const PHONE_RE = /^\+?[0-9]{10,15}$/;

export const signupOwnerSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  // OPTIONAL since 2026-08-12. The signup form no longer asks for it at all
  // — "slug" was the field owners most often got stuck on, and it's an
  // implementation detail they have no way to reason about at that moment.
  // When omitted, AuthService.signupOwner derives one from schoolName via
  // generateUniqueSchoolSlug() (the same generator platform-admin school
  // provisioning already used), so a school named "Bright Star Academy"
  // silently gets `bright-star-academy`.
  //
  // Kept as an accepted input rather than deleted outright: the API is a
  // public surface with existing scripted callers (smoke-test.sh, the
  // integration suites, anyone provisioning programmatically) that pick a
  // deterministic slug on purpose. Supplying one still validates and still
  // wins over the derived value.
  schoolSlug: z
    .string()
    .trim()
    // Strict: no .toLowerCase() normalization. Uppercase input fails the
    // regex below rather than being silently lowered, so a caller that
    // explicitly supplies a slug sees a clear validation error rather than
    // silently getting a different subdomain than the one it asked for.
    .regex(SLUG_RE, "lowercase letters, digits, hyphens; 3–40 chars; cannot start or end with a hyphen")
    .refine((s: string) => !RESERVED_SLUGS.has(s), { message: "slug is reserved" })
    .optional(),
  ownerFirstName: z.string().trim().min(1).max(60),
  ownerLastName: z.string().trim().min(1).max(60),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPhone: z.string().trim().regex(PHONE_RE, "phone must be 10–15 digits, optionally prefixed with +"),
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .max(128, "password must be at most 128 characters")
    .regex(/[A-Z]/, "password must contain at least one uppercase letter")
    .regex(/[a-z]/, "password must contain at least one lowercase letter")
    .regex(/[0-9]/, "password must contain at least one digit")
    .regex(/[^A-Za-z0-9]/, "password must contain at least one special character"),
  ndprConsent: z.literal(true, {
    errorMap: () => ({ message: "NDPR consent is required to create an account" }),
  }),
});

export type SignupOwnerInput = z.infer<typeof signupOwnerSchema>;

// Public-facing user DTO. Mirrors the User row but with the password hash
// stripped and dates serialized as ISO strings (Nest's default JSON
// serializer handles Date → string automatically).
export interface SignupOwnerUserDto {
  id: string;
  schoolId: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  isActive: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  // Null until the owner/admin finishes or skips the first-login product
  // tour; either action stamps it, so this is also "has seen the tour",
  // not literally "completed every step."
  tourCompletedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SignupOwnerSchoolDto {
  id: string;
  name: string;
  slug: string;
  status: string;
  onboardingStep: number;
  ndprConsent: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface SignupOwnerResponse {
  user: SignupOwnerUserDto;
  school: SignupOwnerSchoolDto;
  token: string;
}
