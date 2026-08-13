import { basePrisma } from "@school-kit/db";
import { InternalError, RESERVED_SLUGS } from "@school-kit/types";

// Derives a School.slug from the school's name and guarantees uniqueness.
//
// Originally private to PlatformAdminService.createSchool, whose header
// comment said a shared home wasn't warranted "until a third caller needs
// one." Self-serve signup became the second *generator* caller when the
// slug field was removed from the signup form (2026-08-12) — at which point
// keeping two copies would mean a school provisioned by a platform admin and
// a school created by its own owner could derive different slugs from the
// same name. That's a correctness argument, not a tidiness one, so it moved
// here rather than waiting for a third caller.
//
// Slug rules mirror signupOwnerSchema's SLUG_RE exactly (packages/types/src/
// auth/signup-owner.dto.ts). That one stays a Zod .regex() validating client
// input — still reachable, since schoolSlug remains an accepted optional
// field on the API for callers (tests, smoke-test.sh, anyone scripting
// against the endpoint) that want to pick their own.

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const MAX_SLUG_BASE_LENGTH = 30; // leaves room for a "-NN" collision suffix within the 40-char cap.
const MAX_SLUG_COLLISION_ATTEMPTS = 50;

export function slugifySchoolName(schoolName: string): string {
  const base = schoolName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks left by NFKD)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "school"}-school`;
}

// Retries with a numeric suffix on collision, and skips any candidate that
// lands on a reserved slug (e.g. a school literally named "Admin"). School
// has no RLS, so these are plain basePrisma reads — no tenant context needed.
export async function generateUniqueSchoolSlug(schoolName: string): Promise<string> {
  const base = slugifySchoolName(schoolName);
  for (let attempt = 0; attempt < MAX_SLUG_COLLISION_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    if (!SLUG_RE.test(candidate) || RESERVED_SLUGS.has(candidate)) continue;
    const existing = await basePrisma.school.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Should never happen in practice — MAX_SLUG_COLLISION_ATTEMPTS collisions
  // in a row on the same base slug. Fail loudly rather than create a school
  // with a slug that silently doesn't match its name.
  throw new InternalError(
    `Could not generate a unique slug for "${schoolName}" after ${MAX_SLUG_COLLISION_ATTEMPTS} attempts.`,
  );
}
