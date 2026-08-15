import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  ApiNetworkError,
  apiFetch,
  onUnauthorized,
  setTokenProvider,
} from "./client";

// The client is deliberately free of React Native imports so it can be tested
// directly in Vitest's node environment — see the header comment in client.ts.

const BASE = "http://localhost:4000/api/v1";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setTokenProvider(() => null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch — request shaping", () => {
  it("prefixes the base URL and parses a JSON body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: "stu_1" }));

    const result = await apiFetch<{ id: string }>("/students/stu_1");

    expect(result).toEqual({ id: "stu_1" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/students/stu_1`);
  });

  it("attaches the bearer token from the injected provider", async () => {
    setTokenProvider(() => "tok_abc");
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/portal/students");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_abc");
  });

  it("sends no Authorization header when there is no token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/portal/login", { method: "POST", body: { email: "a@b.c" } });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("JSON-encodes the body and sets Content-Type", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));

    await apiFetch("/portal/login", {
      method: "POST",
      body: { email: "a@b.c", password: "hunter2" },
    });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"email":"a@b.c","password":"hunter2"}');
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
  });

  it("returns undefined for 204 without trying to parse a body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch("/devices/dev_1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});

describe("apiFetch — error handling", () => {
  it("parses the API's { error: { code, message } } envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, {
        error: { code: "VALIDATION_FAILED", message: "Bad input", details: { f: 1 } },
      }),
    );

    const error = await apiFetch("/x").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(422);
    expect(apiError.code).toBe("VALIDATION_FAILED");
    expect(apiError.message).toBe("Bad input");
    expect(apiError.details).toEqual({ f: 1 });
  });

  it("falls back to UNKNOWN_ERROR when the body is not the envelope", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", { status: 502, statusText: "Bad Gateway" }),
    );

    const error = (await apiFetch("/x").catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("UNKNOWN_ERROR");
    expect(error.status).toBe(502);
  });

  it("distinguishes a transport failure from a rejected request", async () => {
    // This distinction is what stops the offline layer from rendering "you
    // have no fees" to someone who simply has no signal.
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    const error = await apiFetch("/portal/students").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiNetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe("apiFetch — unauthorized notification", () => {
  it("notifies subscribers on 401", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "nope" } }),
    );

    await apiFetch("/portal/students").catch(() => undefined);

    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("stays silent when notifyOnUnauthorized is false", async () => {
    // Cold-boot session hydration: an expired token is an expected outcome,
    // not an event that should bounce the user to a login screen.
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "nope" } }),
    );

    await apiFetch("/auth/me", { notifyOnUnauthorized: false }).catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("does not notify on non-401 failures", async () => {
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);
    fetchMock.mockResolvedValue(
      jsonResponse(403, { error: { code: "FORBIDDEN", message: "nope" } }),
    );

    await apiFetch("/x").catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("unsubscribes cleanly", async () => {
    const listener = vi.fn();
    onUnauthorized(listener)();
    fetchMock.mockResolvedValue(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "nope" } }),
    );

    await apiFetch("/x").catch(() => undefined);

    expect(listener).not.toHaveBeenCalled();
  });
});
