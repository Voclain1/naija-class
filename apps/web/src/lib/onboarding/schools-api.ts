// Typed wrappers around the /schools/* endpoints. Shapes come from
// @school-kit/types so the client can't drift from the API.

import type { PatchSchoolInput, SchoolMeDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getSchoolMe(): Promise<SchoolMeDto> {
  return apiFetch<SchoolMeDto>("/schools/me", { method: "GET" });
}

export function patchSchoolMe(input: PatchSchoolInput): Promise<SchoolMeDto> {
  return apiFetch<SchoolMeDto>("/schools/me", {
    method: "PATCH",
    body: input,
  });
}
