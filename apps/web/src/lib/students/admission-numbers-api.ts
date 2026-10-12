// GET / PATCH /schools/me/admission-numbers (docs/modules/admission-numbers.md).

import type { AdmissionNumberSettingsDto, UpdateAdmissionNumberSettingsInput } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getAdmissionNumberSettings(): Promise<AdmissionNumberSettingsDto> {
  return apiFetch<AdmissionNumberSettingsDto>("/schools/me/admission-numbers", { method: "GET" });
}

export function updateAdmissionNumberSettings(
  input: UpdateAdmissionNumberSettingsInput,
): Promise<AdmissionNumberSettingsDto> {
  return apiFetch<AdmissionNumberSettingsDto>("/schools/me/admission-numbers", { method: "PATCH", body: input });
}
