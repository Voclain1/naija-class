// The school's web address, "<code>.schoolkit.ng" (docs/modules/school-addresses.md).

import type { SchoolAddressCheckDto, SchoolAddressDto, SchoolAddressPreviewDto } from "@school-kit/types";

import { apiFetch } from "../api-client";

export function getSchoolAddress(): Promise<SchoolAddressDto> {
  return apiFetch<SchoolAddressDto>("/schools/me/address", { method: "GET" });
}

export function checkSchoolAddress(code: string): Promise<SchoolAddressCheckDto> {
  return apiFetch<SchoolAddressCheckDto>(`/schools/me/address/check?code=${encodeURIComponent(code)}`, { method: "GET" });
}

export function changeSchoolAddress(code: string): Promise<SchoolAddressDto> {
  return apiFetch<SchoolAddressDto>("/schools/me/address", { method: "PUT", body: { code } });
}

/** Public: the address sign-up would give a school with this name. */
export function previewSchoolAddress(name: string): Promise<SchoolAddressPreviewDto> {
  return apiFetch<SchoolAddressPreviewDto>(`/school-addresses/preview?name=${encodeURIComponent(name)}`, { method: "GET" });
}
