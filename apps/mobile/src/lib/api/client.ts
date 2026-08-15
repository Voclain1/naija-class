// School Kit mobile — thin fetch wrapper for the NestJS API.
//
// Mirrors apps/web/src/lib/api-client.ts in responsibilities and error shape,
// with three deliberate differences, all forced by the platform:
//
//   1. NO cookie/proxy path. ADR-002 specifies `Authorization: Bearer` only
//      for apps/mobile — there is no browser cookie jar and no Next.js proxy
//      route to hold one. The API's AuthGuard already reads Bearer directly,
//      so this needs no server change.
//
//   2. The token is supplied by an INJECTED provider rather than read from a
//      module-global that the auth layer writes. That keeps this file free of
//      any React Native import (expo-secure-store is native-only), which is
//      what makes it unit-testable under Vitest's node environment. The real
//      provider is installed once at boot; see src/lib/auth/token-store.ts.
//
//   3. No `window.dispatchEvent`. Unauthorized notification is a plain
//      listener registry — React Native has no DOM EventTarget.
//
// It stays UI-framework-free on purpose: no router import, no navigation. The
// navigation layer subscribes to onUnauthorized and decides what to do.

import type { ErrorBody } from "@school-kit/types";

/**
 * Base URL. Expo only inlines env vars prefixed EXPO_PUBLIC_ into the bundle
 * (the equivalent of Next's NEXT_PUBLIC_). The dev default matches the API's
 * local port and the /api/v1 global prefix.
 */
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/** A non-2xx response carrying the API's `{ error: { code, message } }` body. */
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

/**
 * The request never reached the server — no signal, DNS failure, timeout.
 *
 * Distinct from ApiError on purpose. An ApiError means the server considered
 * the request and rejected it, so retrying unchanged is pointless; an
 * ApiNetworkError means we do not know anything yet, and the offline layer
 * should keep showing cached data rather than treating it as a real failure.
 * Collapsing the two is how "you have no fees" gets rendered to a parent
 * standing in a lift.
 */
export class ApiNetworkError extends Error {
  readonly cause?: unknown;

  constructor(cause?: unknown) {
    super("Network request failed");
    this.name = "ApiNetworkError";
    this.cause = cause;
  }
}

// --- token provider -------------------------------------------------------

type TokenProvider = () => string | null;

let tokenProvider: TokenProvider = () => null;

/**
 * Install the real token source. Called once at boot, after the persisted
 * token has been hydrated from secure storage.
 *
 * Synchronous by design: every request would otherwise await a native
 * keychain read. The store keeps an in-memory copy and this reads that.
 */
export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

// --- unauthorized notification -------------------------------------------

type UnauthorizedListener = () => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Subscribe to 401s. Returns an unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}

// --- request --------------------------------------------------------------

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /**
   * When true (default), a 401 notifies subscribers so the app can clear
   * session state and route to login. Set false for cold-boot session
   * hydration, where an expired token is an expected outcome rather than an
   * event worth reacting to.
   */
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
  const token = tokenProvider();
  if (token && !finalHeaders.has("Authorization")) {
    finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // fetch() rejects only on transport failure; any HTTP status resolves.
    throw new ApiNetworkError(cause);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body on a non-2xx is handled by the envelope fallback
      // below. On a 2xx it is a contract violation worth surfacing loudly.
      if (response.ok) {
        throw new ApiError(response.status, {
          code: "MALFORMED_RESPONSE",
          message: "The server returned a response that was not valid JSON.",
        });
      }
    }
  }

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
      notifyUnauthorized();
    }

    throw new ApiError(response.status, errorBody);
  }

  return parsed as T;
}
