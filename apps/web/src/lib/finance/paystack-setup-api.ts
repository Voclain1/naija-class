// Typed wrappers around /schools/me/paystack-setup-request. Shapes come from
// @school-kit/types so the client can't drift from the API.

import type {
  CreatePaystackSetupRequestInput,
  PaystackSetupRequestDto,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

// Null when the school has never submitted one — the settings page shows the
// request form in that case, and the submitted state otherwise.
export function getPaystackSetupRequest(): Promise<PaystackSetupRequestDto | null> {
  return apiFetch<PaystackSetupRequestDto | null>("/schools/me/paystack-setup-request", {
    method: "GET",
  });
}

export function createPaystackSetupRequest(
  input: CreatePaystackSetupRequestInput,
): Promise<PaystackSetupRequestDto> {
  return apiFetch<PaystackSetupRequestDto>("/schools/me/paystack-setup-request", {
    method: "POST",
    body: input,
  });
}
