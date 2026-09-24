import type {
  WebHandoffResponse,
  MeResponse,
  StaffMobileChallengeInput,
  StaffMobileLoginInput,
  StaffMobileLoginResponse,
  StaffSessionListResponse,
} from "@school-kit/types";
import { apiFetch } from "./client";

export function staffMobileLogin(input: StaffMobileLoginInput): Promise<StaffMobileLoginResponse> {
  return apiFetch("/auth/mobile/login", { method: "POST", body: input });
}

export function staffMobileChallenge(input: StaffMobileChallengeInput): Promise<StaffMobileLoginResponse> {
  return apiFetch("/auth/mobile/2fa/challenge", { method: "POST", body: input });
}

export function staffMe(): Promise<MeResponse> {
  return apiFetch("/auth/me");
}

export function staffLogout(): Promise<void> {
  return apiFetch("/auth/logout", { method: "POST", notifyOnUnauthorized: false });
}

export function staffSessions(): Promise<StaffSessionListResponse> {
  return apiFetch("/auth/sessions");
}

export function revokeStaffSession(sessionId: string): Promise<void> {
  return apiFetch(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

/**
 * Mint a single-use handoff token so the website can open already signed in
 * (docs/modules/web-handoff-signin.md). 60-second life, one use.
 */
export function staffWebHandoff(next: string): Promise<WebHandoffResponse> {
  return apiFetch<WebHandoffResponse>("/auth/web-handoff", { method: "POST", body: { next } });
}
