// Thin fetch wrapper for the NestJS API. Responsibilities:
//   1. Prepend the base URL from NEXT_PUBLIC_API_URL (e.g. http://localhost:4000/api/v1)
//   2. Send the sk_session HttpOnly cookie (credentials: "include"). The page
//      never holds the session token: the API reads the cookie itself, from
//      this app's Origin only (docs/deferred.md item 1, 2026-10-05)
//   3. Parse the API's { error: { code, message, details? } } envelope into
//      a typed ApiError on non-2xx responses
//   4. Notify the auth layer on 401 so it can clear state and redirect
//
// The router is NOT touched here: this module stays UI-framework-free for
// testability. The auth provider listens for the AUTH_UNAUTHORIZED_EVENT
// and handles the redirect.

import type { ErrorBody } from "@school-kit/types";

export const AUTH_UNAUTHORIZED_EVENT = "sk:auth:unauthorized";

/**
 * Detail carried by AUTH_UNAUTHORIZED_EVENT: the `code` from the API's
 * `{ error: { code, message } }` envelope, so the listener can tell an
 * expiry from a revocation from a deactivated account.
 */
export interface UnauthorizedEventDetail {
  code: string;
}

// A Vercel preview cannot reach the API directly (wrong cookie domain, and
// an origin the API does not allow), so its calls go through its own
// /api/preview-api route instead. next.config.mjs sets the flag for preview
// builds only; production and development call the API directly.
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_VIA_PREVIEW_PROXY === "1"
    ? "/api/preview-api"
    : (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1");

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

export const NETWORK_ERROR_CODE = "NETWORK_ERROR";
export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach the server. Check your internet connection and try again.";

/**
 * The request never got an answer from the API: offline, DNS, CORS, a reset
 * connection, or a gateway page in place of our JSON envelope.
 *
 * It extends ApiError ON PURPOSE. Roughly 300 call sites read
 * `err instanceof ApiError ? err.message : "Could not …"`; as a subclass, every
 * one of them now says "couldn't reach the server" instead of a generic
 * failure, with no edit. `status` is 0, which matches no real HTTP status, so
 * branches on 401/403/404/409/5xx never mistake it for an answer. Code that
 * must tell the two apart checks `instanceof ApiNetworkError` first.
 *
 * Same idea as apps/mobile's ApiNetworkError (which, unlike this one, is not an
 * ApiError: the app's offline layer must keep cached data on it).
 */
export class ApiNetworkError extends ApiError {
  override readonly cause?: unknown;

  constructor(cause?: unknown) {
    super(0, { code: NETWORK_ERROR_CODE, message: NETWORK_ERROR_MESSAGE });
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

/**
 * fetch() that turns a transport failure into ApiNetworkError. An abort the
 * caller asked for is rethrown untouched: that is a decision, not a failure.
 */
export async function fetchOrNetworkError(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiNetworkError(cause);
  }
}

/**
 * Reads a response body as JSON. A body that is not JSON (a proxy's HTML
 * error page during a deploy or an outage) means our API did not answer, so
 * it is reported as a network failure rather than a SyntaxError.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ApiNetworkError(cause);
  }
}

// One-time cleanup: remove the pre-cookie-strategy localStorage key if present.
// Safe to run on every load — removeItem is a no-op if the key doesn't exist.
if (typeof window !== "undefined") {
  window.localStorage.removeItem("sk_auth_token");
}

interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  // When true (default), a 401 response fires AUTH_UNAUTHORIZED_EVENT. Set false for the /auth/me hydration call so
  // a missing/expired token on cold boot doesn't redirect — the provider
  // handles that path by transitioning to `guest` quietly.
  notifyOnUnauthorized?: boolean;
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const response = await apiFetchResponse(path, options);
  if (response.status === 204) {
    return undefined as T;
  }
  return (await readJsonBody(response)) as T;
}

/**
 * apiFetch without the JSON decode, for the few calls whose success body is
 * not JSON (CSV downloads). Same base URL, auth, error envelope, 401 event and
 * network-failure wrapping; a non-2xx still throws ApiError.
 */
export async function apiFetchResponse(
  path: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { body, headers, notifyOnUnauthorized = true, ...rest } = options;

  // FormData (multipart file uploads — expense receipts) must NOT be
  // JSON.stringify'd, and must NOT get an explicit Content-Type: the browser
  // sets multipart/form-data with the correct boundary itself. Every other
  // caller passes a plain object body and gets the existing JSON behavior.
  const isFormData = body instanceof FormData;

  const finalHeaders = new Headers(headers);
  if (body !== undefined && !isFormData && !finalHeaders.has("Content-Type")) {
    finalHeaders.set("Content-Type", "application/json");
  }
  const response = await fetchOrNetworkError(`${API_BASE_URL}${path}`, {
    // Prevent the browser from sending If-None-Match / If-Modified-Since.
    // NestJS adds ETag headers by default; a cached 304 has no body, which
    // causes apiFetch to throw an ApiError and silently blank state setters.
    cache: "no-store",
    // The session cookie. The API allows credentials for this origin only.
    credentials: "include",
    ...rest,
    headers: finalHeaders,
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  if (response.ok) return response;

  const parsed = await readJsonBody(response);
  const errorBody: ErrorBody =
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object"
      ? (parsed.error as ErrorBody)
      : { code: "UNKNOWN_ERROR", message: response.statusText };

  if (response.status === 401 && notifyOnUnauthorized) {
    if (typeof window !== "undefined") {
      // Carry the API's own error code to the listener. AuthGuard has
      // always distinguished SESSION_EXPIRED / INVALID_SESSION /
      // USER_INACTIVE / MISSING_BEARER_TOKEN; this event used to drop that
      // on the floor, which is why every sign-out looked identical to the
      // user (F-10). The auth provider maps it to a reason — see
      // lib/auth/session-end.ts.
      window.dispatchEvent(
        new CustomEvent<UnauthorizedEventDetail>(AUTH_UNAUTHORIZED_EVENT, {
          detail: { code: errorBody.code },
        }),
      );
    }
  }

  throw new ApiError(response.status, errorBody);
}

// Thin wrapper for Next.js proxy routes under /api/* (relative paths — the
// route handler reads/writes the sk_session cookie server-side). Used for every session-mutating call: login, signup,
// logout, 2fa/challenge (all under /api/auth/*), and invitation-accept
// (/api/invitations/:token/accept) — anything that mints or clears a
// session must go through one of these proxy routes, never plain apiFetch,
// or the sk_session cookie never gets set/cleared on the web origin.
export async function proxyFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetchOrNetworkError(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const parsed = await readJsonBody(res);
  if (!res.ok) {
    const err =
      (parsed as { error?: ErrorBody } | null)?.error ?? {
        code: "UNKNOWN_ERROR",
        message: res.statusText,
      };
    throw new ApiError(res.status, err);
  }
  return parsed as T;
}
