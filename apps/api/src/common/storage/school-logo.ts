import type { StorageService } from "./storage.service";

// The school's logo as a directly displayable, signed URL. Shared by the staff
// endpoint (GET /schools/me/logo-url) and the family-facing school read
// (GET /portal/school, GET /student-portal/me/school), which show the school's
// own logo on every signed-in surface (docs/modules/school-identity.md).

// Long relative to receipts' 15 minutes — a logo is displayed persistently
// in the topbar for the life of a session, not fetched once for a single
// click-through. See SchoolLogoUrlDto's own comment in school.dto.ts.
export const LOGO_URL_TTL_SECONDS = 60 * 60;

export type LogoExt = "png" | "jpg" | "webp";

// Recovers the school-logo StorageObjectKey's `ext` from the canonical path
// persisted on School.logoUrl (e.g. "schools/<id>/logo.png" -> "png").
// Defensive on any non-logo value: logoUrl should only ever be written by
// SchoolsService.uploadLogo(), but a stray/legacy value shouldn't 500 the caller.
export function parseLogoExt(logoUrl: string | null | undefined): LogoExt | null {
  if (!logoUrl) return null;
  const ext = logoUrl.split(".").pop();
  return ext === "png" || ext === "jpg" || ext === "webp" ? ext : null;
}

// Null when the school has no logo (the caller shows initials instead).
export async function signSchoolLogoUrl(
  storage: StorageService,
  schoolId: string,
  logoPath: string | null | undefined,
): Promise<string | null> {
  const ext = parseLogoExt(logoPath);
  if (!ext) return null;
  return storage.signUrl(schoolId, { kind: "school-logo", ext }, LOGO_URL_TTL_SECONDS);
}
