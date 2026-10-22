import { z } from "zod";

import { RESERVED_SLUGS } from "../auth/reserved-slugs.js";

// A school's web address (docs/modules/school-addresses.md, 2026-10-22).
//
// The address IS schools.slug: "<code>.schoolkit.ng", and the school code
// students type to sign in. A school chooses a new one within limits; every
// earlier code keeps working and is never given to another school.

/** The domain every school's address sits under. */
export const SCHOOL_ADDRESS_DOMAIN = "schoolkit.ng";

/**
 * A new code: 3 to 30 lower-case letters, digits and single hyphens, starting
 * and ending with a letter or digit. Codes made before 2026-10-22 may run to
 * 40 characters; they stay valid, but a change must fit these rules.
 */
export const SCHOOL_ADDRESS_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

/** The rules every free change runs inside. */
export const SCHOOL_ADDRESS_LIMITS = {
  /** Free changes for this many days after the school is created (and while it is still onboarding). */
  freeDays: 30,
  /** Changes a school may make in any 12 months after that. */
  perYear: 2,
  /** Days between two counted changes. */
  minDaysBetween: 30,
} as const;

export function schoolHost(code: string): string {
  return `${code}.${SCHOOL_ADDRESS_DOMAIN}`;
}

/** Trimmed, lower-cased, spaces and underscores turned into hyphens: how a typed code is read. */
export function normaliseSchoolAddress(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export type SchoolAddressProblem = "INVALID" | "RESERVED";

/** Format and reserved-word check only; whether it is free is the server's call. */
export function schoolAddressProblem(code: string): SchoolAddressProblem | null {
  if (!SCHOOL_ADDRESS_RE.test(code)) return "INVALID";
  if (RESERVED_SLUGS.has(code)) return "RESERVED";
  return null;
}

export const changeSchoolAddressSchema = z.object({
  code: z
    .string()
    .transform(normaliseSchoolAddress)
    .refine((c) => SCHOOL_ADDRESS_RE.test(c), {
      message: "Use 3 to 30 letters, numbers and hyphens, starting and ending with a letter or number.",
    }),
});
export type ChangeSchoolAddressInput = z.infer<typeof changeSchoolAddressSchema>;

export interface SchoolAddressDto {
  code: string;
  host: string;
  /** Earlier codes, newest first. They keep working and lead here. */
  previousCodes: string[];
  /** Whether THIS user may change it now: the owner, inside the limits. */
  canChange: boolean;
  /** The owner may change it freely until this moment (ISO), else null. */
  freeUntil: string | null;
  /** Counted changes left in the current 12 months, once the free window has passed. */
  changesLeft: number;
  /** When the next counted change is allowed, if it is not allowed now (ISO). */
  nextChangeAt: string | null;
  /** Why a change is not possible now, in words, or null. */
  blockedReason: string | null;
}

export type SchoolAddressAvailability = "AVAILABLE" | "CURRENT" | "TAKEN" | "RESERVED" | "INVALID";

export interface SchoolAddressCheckDto {
  code: string;
  host: string;
  status: SchoolAddressAvailability;
}

/** GET /schools/address-preview?name= — the address sign-up would give a school of this name. */
export interface SchoolAddressPreviewDto {
  code: string;
  host: string;
}
