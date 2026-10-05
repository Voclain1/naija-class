// Typed wrappers around auth endpoints.
//
// Two transport layers:
//   proxyFetch — calls the Next.js route handler at /api/auth/*, which
//     manages the sk_session HttpOnly cookie.  Used for the four
//     session-mutating operations (login, signup, logout, 2fa/challenge).
//   apiFetch   — calls NestJS directly; the browser sends the sk_session
//     cookie. Used for everything else (me, 2fa management endpoints).
//
// No response here carries the session token: the proxy routes strip it, and
// the page never needs it (docs/deferred.md item 1).

import type {
  ForgotPasswordInput,
  ForgotPasswordResponse,
  LoginInput,
  LoginResponse,
  MeResponse,
  ResetPasswordInput,
  ResetPasswordResponse,
  SignupOwnerInput,
  SignupOwnerResponse,
  TotpChallengeInput,
  TotpConfirmInput,
  TotpDisableInput,
  TotpSetupResponseDto,
  TotpStatusDto,
  StaffSessionListResponse,
} from "@school-kit/types";

import { apiFetch, proxyFetch } from "../api-client";

/** A session-issuing response as the browser receives it: the proxy keeps the token. */
export type WebLoginResponse =
  | Omit<Extract<LoginResponse, { requiresTwoFactor: false }>, "token">
  | Extract<LoginResponse, { requiresTwoFactor: true }>;
export type WebSignupOwnerResponse = Omit<SignupOwnerResponse, "token">;

// ---- Session-mutating calls (via Next.js proxy — cookie managed server-side) ----

export function loginRequest(input: LoginInput): Promise<WebLoginResponse> {
  return proxyFetch<WebLoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function signupOwnerRequest(input: SignupOwnerInput): Promise<WebSignupOwnerResponse> {
  return proxyFetch<WebSignupOwnerResponse>("/api/auth/signup-owner", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Logout is best-effort. Even if the request fails we still clear local state.
export function logoutRequest(): Promise<void> {
  return proxyFetch<void>("/api/auth/logout", { method: "POST" });
}

export function twoFactorChallengeRequest(input: TotpChallengeInput): Promise<WebLoginResponse> {
  return proxyFetch<WebLoginResponse>("/api/auth/2fa/challenge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Cold-boot hydration: does a session cookie exist? (Validity is the API's
// call, via /auth/me.) The route also moves a pre-switch-over cookie onto the
// shared domain the API reads, so it must run before the first API call.
export async function sessionRequest(): Promise<boolean> {
  const data = await proxyFetch<{ authenticated: boolean }>("/api/auth/session", { method: "GET" });
  return data.authenticated;
}

// ---- Direct NestJS calls (the browser sends the sk_session cookie) ----

// notifyOnUnauthorized=false: a 401 on cold boot means "no session", not
// a mid-use expiry — the provider handles it by transitioning to `guest`
// quietly rather than firing the global redirect event.
export function meRequest(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me", {
    method: "GET",
    notifyOnUnauthorized: false,
  });
}

export function twoFactorStatusRequest(): Promise<TotpStatusDto> {
  return apiFetch<TotpStatusDto>("/auth/2fa/status", { method: "GET" });
}

export function twoFactorSetupRequest(): Promise<TotpSetupResponseDto> {
  return apiFetch<TotpSetupResponseDto>("/auth/2fa/setup", { method: "POST" });
}

export function twoFactorConfirmRequest(input: TotpConfirmInput): Promise<void> {
  return apiFetch<void>("/auth/2fa/confirm", { method: "POST", body: input });
}

export function twoFactorDisableRequest(input: TotpDisableInput): Promise<void> {
  // notifyOnUnauthorized: false — a 401 here means wrong password (INVALID_CREDENTIALS),
  // not an expired session. The caller (security-settings.tsx) catches the error and
  // shows an inline field error; letting the global 401 handler fire would log the user out.
  return apiFetch<void>("/auth/2fa", { method: "DELETE", body: input, notifyOnUnauthorized: false });
}

export function staffSessionsRequest(): Promise<StaffSessionListResponse> {
  return apiFetch<StaffSessionListResponse>("/auth/sessions", { method: "GET" });
}

export function revokeStaffSessionRequest(sessionId: string): Promise<void> {
  return apiFetch<void>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

// Both public — no session exists yet (forgot-password) or is being
// deliberately NOT auto-created (reset-password; see auth.service.ts's
// resetPassword() for why). Plain apiFetch, not proxyFetch: unlike login/
// signup/logout/2fa-challenge, neither of these mutates the sk_session
// cookie, so there is nothing for the Next.js proxy route to manage. Same
// notifyOnUnauthorized:false reasoning as the invitations endpoints — a 401
// from a public endpoint would never be a real session expiry.
export function forgotPasswordRequest(input: ForgotPasswordInput): Promise<ForgotPasswordResponse> {
  return apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
    method: "POST",
    body: input,
    notifyOnUnauthorized: false,
  });
}

export function resetPasswordRequest(input: ResetPasswordInput): Promise<ResetPasswordResponse> {
  return apiFetch<ResetPasswordResponse>("/auth/reset-password", {
    method: "POST",
    body: input,
    notifyOnUnauthorized: false,
  });
}
