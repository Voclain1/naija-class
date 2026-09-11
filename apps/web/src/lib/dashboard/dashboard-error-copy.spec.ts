import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api-client";

import { dashboardErrorMessage } from "./dashboard-error-copy";

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const COPY = "We couldn’t load your dashboard. Refresh and try again.";

/** The capture context of the first call, asserted to exist so the test fails
 *  loudly if nothing was captured rather than on an undefined property. */
function firstCaptureContext(): { tags: Record<string, string>; extra?: Record<string, unknown> } {
  const call = captureException.mock.calls[0];
  expect(call).toBeDefined();
  return call![1] as { tags: Record<string, string>; extra?: Record<string, unknown> };
}

describe("dashboardErrorMessage", () => {
  beforeEach(() => {
    captureException.mockClear();
  });

  it("does not expose a raw backend error", () => {
    expect(dashboardErrorMessage(new Error("DATABASE_TIMEOUT: 5xx"))).toBe(COPY);
  });

  // The 2026-09-11 gap: this function used to discard its argument entirely,
  // so every dashboard failure looked identical in telemetry as well as on
  // screen. The copy staying constant is the point — the capture is what makes
  // the next occurrence diagnosable.
  it("captures what was caught, even though it never displays it", () => {
    dashboardErrorMessage(new Error("boom"));
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a server fault from a transport fault", () => {
    dashboardErrorMessage(
      new ApiError(500, { code: "INTERNAL_ERROR", message: "An unexpected error occurred." }),
    );
    expect(firstCaptureContext().tags).toMatchObject({
      surface: "admin-dashboard",
      failureKind: "api-5xx",
      apiCode: "INTERNAL_ERROR",
    });
    expect(firstCaptureContext().extra).toEqual({ status: 500 });

    captureException.mockClear();
    // fetch() rejects with TypeError when no response was received at all.
    dashboardErrorMessage(new TypeError("Failed to fetch"));
    expect(firstCaptureContext().tags).toMatchObject({
      surface: "admin-dashboard",
      failureKind: "network",
    });
  });

  it("classifies a 4xx separately from a 5xx", () => {
    dashboardErrorMessage(new ApiError(403, { code: "FORBIDDEN", message: "No." }));
    expect(firstCaptureContext().tags.failureKind).toBe("api-4xx");
  });

  it("still returns the same copy for every kind", () => {
    expect(dashboardErrorMessage(new TypeError("Failed to fetch"))).toBe(COPY);
    expect(dashboardErrorMessage(new ApiError(403, { code: "FORBIDDEN", message: "No." }))).toBe(
      COPY,
    );
    expect(dashboardErrorMessage("a bare string throw")).toBe(COPY);
  });
});
