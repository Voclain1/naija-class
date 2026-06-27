// Thin fetch wrapper for the NestJS API. Responsibilities:
//   1. Prepend the base URL from NEXT_PUBLIC_API_URL (e.g. http://localhost:4000/api/v1)
//   2. Attach `Authorization: Bearer <token>` when a token is present
//   3. Parse the API's { error: { code, message, details? } } envelope into
//      a typed ApiError on non-2xx responses
//   4. Notify the auth layer on 401 so it can clear state and redirect
//
// The router is NOT touched here: this module stays UI-framework-free for
// testability. The auth provider listens for the AUTH_UNAUTHORIZED_EVENT
// and handles the redirect.

import type { ErrorBody } from "@school-kit/types";

export const AUTH_UNAUTHORIZED_EVENT = "sk:auth:unauthorized";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, body: ErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.status = status;
    this.details = body.details;
  }
}

// One-time cleanup: remove the pre-cookie-strategy localStorage key if present.
// Safe to run on every load — removeItem is a no-op if the key doesn't exist.
if (typeof window !== "undefined") {
  window.localStorage.removeItem("sk_auth_token");
}

// Module-level in-memory token. Set by the auth provider on login/signup/
// cold-boot hydration; cleared on logout. NOT persisted — a hard reload
// drops it and the provider re-seeds from the sk_session HttpOnly cookie
// via GET /api/auth/session.
let activeToken: string | null = null;

export function getStoredToken(): string | null {
  return activeToken;
}

export function setStoredToken(token: string): void {
  activeToken = token;
}

export function clearStoredToken(): void {
  activeToken = null;
}

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  // When true (default), a 401 response clears the stored token and fires
  // AUTH_UNAUTHORIZED_EVENT. Set false for the /auth/me hydration call so
  // a missing/expired token on cold boot doesn't redirect — the provider
  // handles that path by transitioning to `guest` quietly.
  notifyOnUnauthorized?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { body, headers, notifyOnUnauthorized = true, ...rest } = options;

  const finalHeaders = new Headers(headers);
  if (body !== undefined && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  const token = getStoredToken();
  if (token && !finalHeaders.has("Authorization")) {
    finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const errorBody: ErrorBody =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      parsed.error &&
      typeof parsed.error === "object"
        ? (parsed.error as ErrorBody)
        : { code: "UNKNOWN_ERROR", message: response.statusText };

    if (response.status === 401 && notifyOnUnauthorized) {
      clearStoredToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(AUTH_UNAUTHORIZED_EVENT));
      }
    }

    throw new ApiError(response.status, errorBody);
  }

  return parsed as T;
}
