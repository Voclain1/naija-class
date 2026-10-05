import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiNetworkError, NETWORK_ERROR_CODE, NETWORK_ERROR_MESSAGE, apiFetch } from "./api-client";
import { financeErrorMessage } from "./finance/error-copy";

// apiFetch's failure kinds (docs/deferred.md item 4, 2026-10-05). A request
// that never got an answer used to escape as a bare TypeError, so every
// screen's "Could not …" fallback hid whether the server was even reached.

function stubFetch(impl: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch failures", () => {
  it("wraps a fetch rejection as ApiNetworkError, which is also an ApiError", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await apiFetch("/students").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
    // The subclass is the point: the ~300 `err instanceof ApiError ? err.message : …`
    // call sites now show the network sentence with no edit.
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
    expect((err as ApiError).code).toBe(NETWORK_ERROR_CODE);
    expect((err as ApiError).message).toBe(NETWORK_ERROR_MESSAGE);
    expect((err as ApiNetworkError).cause).toBeInstanceOf(TypeError);
  });

  it("treats a non-JSON body (a gateway's HTML error page) as a network failure", async () => {
    stubFetch(() => Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })));
    await expect(apiFetch("/students")).rejects.toBeInstanceOf(ApiNetworkError);
  });

  it("leaves a caller's own abort alone", async () => {
    stubFetch(() => Promise.reject(new DOMException("The operation was aborted.", "AbortError")));
    const err = await apiFetch("/students").catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("still reports a real API answer as a plain ApiError with its envelope", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Student not found." } }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const err = await apiFetch("/students/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(ApiNetworkError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("Student not found.");
  });

  it("returns the decoded body on success and undefined on 204", async () => {
    stubFetch(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(apiFetch("/x")).resolves.toEqual({ ok: true });
    stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(apiFetch("/x")).resolves.toBeUndefined();
  });

  it("reads as the network sentence in the finance copy, not a server error", () => {
    expect(financeErrorMessage(new ApiNetworkError())).toBe(NETWORK_ERROR_MESSAGE);
  });
});
