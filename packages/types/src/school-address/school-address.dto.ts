import { z } from "zod";

import { RESERVED_SLUGS } from "../auth/reserved-slugs.js";
import type { PublicWebsiteDto } from "../school-website/school-website.dto.js";

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

/**
 * GET /school-addresses/:code — PUBLIC. What the school's front page at
 * "<code>.schoolkit.ng" shows (docs/modules/school-addresses.md slice 2): the
 * school's own public details, never anything about a child or a parent.
 */
export interface SchoolPublicDto {
  /** The school's CURRENT code. A page reached through an older one redirects here. */
  code: string;
  name: string;
  motto: string | null;
  /** Signed for an hour, or null: the page shows SchoolKit's mark instead. */
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  /** The admission form is open to at least one class. */
  admissionsOpen: boolean;
  /** Results can be checked with a PIN for at least one term. */
  resultChecker: boolean;
  /** The school's own sections, by plan (docs/modules/school-website.md). */
  website: PublicWebsiteDto;
  /** For search engines and link previews (docs/modules/school-website.md, "Search"). */
  seo: SchoolSeoDto;
}

/**
 * What search engines and link previews need. The URLs are the CANONICAL ones:
 * the school's own address once addresses are live, else the portal's. The
 * API decides, because only it knows whether addresses are live, so a page
 * never names an address that does not work yet.
 */
export interface SchoolSeoDto {
  urls: { home: string; news: string; gallery: string; apply: string; results: string };
  /** The school's own words for Google, or null to compose one. */
  description: string | null;
  /** Typed in the editor, else taken from the address; null if neither. */
  town: string | null;
  /** "Nursery", "Primary"…, from the published page details. */
  levels: string[];
  founded: number | null;
  /** When the published page last changed, for the sitemap. */
  updatedAt: string | null;
}

/** GET /school-addresses/:code/sitemap — every public page, canonical URLs. */
export interface SchoolSitemapDto {
  entries: { url: string; lastModified: string | null }[];
}

/** GET /school-addresses/sitemap-index — each live school's sitemap. */
export interface SchoolSitemapIndexDto {
  sitemaps: { url: string; lastModified: string | null }[];
}
