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
  schoolSlug: z
    .string()
    .trim()
    // Strict: no .toLowerCase() normalization. Uppercase input fails the
    // regex below rather than being silently lowered, so the user sees a
    // clear validation error and realises the slug they typed is not the
    // subdomain they'll get.
    .regex(SLUG_RE, "lowercase letters, digits, hyphens; 3–40 chars; cannot start or end with a hyphen")
    .refine((s: string) => !RESERVED_SLUGS.has(s), { message: "slug is reserved" }),
  ownerFirstName: z.string().trim().min(1).max(60),
  ownerLastName: z.string().trim().min(1).max(60),
  ownerEmail: z.string().trim().toLowerCase().email(),
  ownerPhone: z.string().trim().regex(PHONE_RE, "phone must be 10–15 digits, optionally prefixed with +"),
  password: z
    .string()
    .min(8, "password must be at least 8 characters")
    .max(128, "password must be at most 128 characters")
    .regex(/[A-Za-z]/, "password must contain at least one letter")
    .regex(/[0-9]/, "password must contain at least one digit"),
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
