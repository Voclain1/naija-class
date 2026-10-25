import type { GuardianConsentDto } from "@school-kit/types";

import { apiFetch } from "./client";

// A parent's agreement to the privacy policy and terms
// (docs/modules/data-protection.md).
export const myGuardianConsent = () => apiFetch<GuardianConsentDto>("/portal/me/consent", { method: "GET" });

export const giveGuardianConsent = () =>
  apiFetch<GuardianConsentDto>("/portal/me/consent", { method: "POST", body: { consent: true } });
