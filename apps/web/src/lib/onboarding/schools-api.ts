// Typed wrappers around the /schools/* endpoints. Shapes come from
// @school-kit/types so the client can't drift from the API.

import type {
  PatchSchoolInput,
  RequestSmsSenderInput,
  SchoolLogoUrlDto,
  SchoolMeDto,
  SmsSenderDto,
} from "@school-kit/types";

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

// Real logo upload (visual/UX overhaul initiative, 2026-07-26) — replaces
// the old raw logoUrl text field. apiFetch already special-cases a
// FormData body (skips JSON.stringify, lets the browser set the multipart
// boundary itself), so no separate fetch wrapper is needed here.
export function uploadSchoolLogo(file: File): Promise<SchoolMeDto> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<SchoolMeDto>("/schools/me/logo", {
    method: "POST",
    body: form,
  });
}

// Returns a freshly-signed, directly displayable image URL — set it
// straight as an <img src>. Browser-native image loads aren't subject to
// CORS the way fetch()/XHR are, so no blob-URL dance is needed (same
// pattern as expense receipts' getExpenseReceiptUrl, just consumed via
// <img> instead of window.open). 404s if no logo has been uploaded yet —
// callers should catch that and fall back to text-only branding.
export function getSchoolLogoUrl(): Promise<SchoolLogoUrlDto> {
  return apiFetch<SchoolLogoUrlDto>("/schools/me/logo-url", { method: "GET" });
}

// The school's own SMS sender name (docs/modules/school-identity.md slice 2).
// Owner/admin only. The school asks; SchoolKit submits it to the networks and
// records their decision, so this never switches a name on by itself.
export function getSmsSender(): Promise<SmsSenderDto> {
  return apiFetch<SmsSenderDto>("/schools/me/sms-sender", { method: "GET" });
}

export function requestSmsSender(input: RequestSmsSenderInput): Promise<SmsSenderDto> {
  return apiFetch<SmsSenderDto>("/schools/me/sms-sender", { method: "POST", body: input });
}
