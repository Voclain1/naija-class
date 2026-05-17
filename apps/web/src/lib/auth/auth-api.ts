// Typed wrappers around the auth endpoints exposed by apps/api.
// Shapes come from @school-kit/types so the client cannot drift.

import type {
  LoginInput,
  LoginResponse,
  MeResponse,
  SignupOwnerInput,
  SignupOwnerResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

export function loginRequest(input: LoginInput): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: input,
  });
}

export function signupOwnerRequest(
  input: SignupOwnerInput,
): Promise<SignupOwnerResponse> {
  return apiFetch<SignupOwnerResponse>("/auth/signup-owner", {
    method: "POST",
    body: input,
  });
}

// Used by the auth provider during hydration. We pass
// notifyOnUnauthorized=false because a 401 here means "no valid session
// on cold boot" — that's a normal guest state, not a session expiry
// mid-use, so we should transition to `guest` quietly instead of firing
// the global redirect event (which would loop on the /login page).
export function meRequest(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me", {
    method: "GET",
    notifyOnUnauthorized: false,
  });
}

// Logout is best-effort. The bearer-token session row is server-side, so
// we hit the endpoint to delete it, but even if the request fails we still
// clear local state — there's no point trapping the user in a broken
// session on the client.
export function logoutRequest(): Promise<void> {
  return apiFetch<void>("/auth/logout", { method: "POST" });
}
