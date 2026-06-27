// Typed wrappers around auth endpoints.
//
// Two transport layers:
//   proxyFetch — calls the Next.js route handler at /api/auth/*, which
//     manages the sk_session HttpOnly cookie.  Used for the four
//     session-mutating operations (login, signup, logout, 2fa/challenge).
//   apiFetch   — calls NestJS directly with the in-memory bearer token.
//     Used for everything else (me, 2fa management endpoints).

import type {
  LoginInput,
  LoginResponse,
  MeResponse,
  SignupOwnerInput,
  SignupOwnerResponse,
  TotpChallengeInput,
  TotpConfirmInput,
  TotpDisableInput,
  TotpSetupResponseDto,
  TotpStatusDto,
} from "@school-kit/types";

import { ApiError, apiFetch } from "../api-client";

// Thin wrapper for Next.js proxy routes (relative paths, no auth header —
// the route handler reads/writes the sk_session cookie server-side).
async function proxyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err =
      (parsed as { error?: { code: string; message: string; details?: unknown } } | null)
        ?.error ?? { code: "UNKNOWN_ERROR", message: res.statusText };
    throw new ApiError(res.status, err);
  }
  return parsed as T;
}

// ---- Session-mutating calls (via Next.js proxy — cookie managed server-side) ----

export function loginRequest(input: LoginInput): Promise<LoginResponse> {
  return proxyFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function signupOwnerRequest(input: SignupOwnerInput): Promise<SignupOwnerResponse> {
  return proxyFetch<SignupOwnerResponse>("/api/auth/signup-owner", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Logout is best-effort. Even if the request fails we still clear local state.
export function logoutRequest(): Promise<void> {
  return proxyFetch<void>("/api/auth/logout", { method: "POST" });
}

export function twoFactorChallengeRequest(input: TotpChallengeInput): Promise<LoginResponse> {
  return proxyFetch<LoginResponse>("/api/auth/2fa/challenge", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// Cold-boot hydration: read the sk_session cookie server-side and return the
// token for in-memory storage. Returns null if no valid session cookie exists.
export async function sessionRequest(): Promise<string | null> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) return null;
  const data = (await res.json()) as { token: string | null };
  return data.token;
}

// ---- Direct NestJS calls (bearer token via in-memory activeToken) ----

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
