import type { SchoolContactResponse, SchoolLogoUrlDto } from "@school-kit/types";

import { apiFetch } from "./client";
import type { Principal } from "../auth/principal";

// The school's logo as a signed, directly displayable URL, or null when the
// school has none (docs/modules/school-identity.md, slice 1). Each principal
// reads it from the endpoint its own session can reach.
export async function getSchoolLogoUrl(principal: Principal): Promise<string | null> {
  if (principal === "staff") {
    try {
      return (await apiFetch<SchoolLogoUrlDto>("/schools/me/logo-url")).url;
    } catch {
      // 404 when no logo has been uploaded: the badge shows initials.
      return null;
    }
  }
  const path = principal === "student" ? "/student-portal/me/school" : "/portal/school";
  return (await apiFetch<SchoolContactResponse>(path)).logoUrl;
}
