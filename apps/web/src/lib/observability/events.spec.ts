import { beforeEach, describe, expect, it, vi } from "vitest";

const { capture } = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { capture, __loaded: true } }));

import { issuePathsOf, normaliseIssuePath, trackOnboardingServerRejection } from "./events";

// The onboarding rejection event (2026-10-10). Field shapes only.
describe("onboarding rejection analytics", () => {
  beforeEach(() => {
    capture.mockReset();
    (globalThis as { window?: unknown }).window = globalThis;
  });

  it("normalises indexes and ids to *", () => {
    expect(normaliseIssuePath("terms.0.startDate")).toBe("terms.*.startDate");
    expect(normaliseIssuePath(["guardians", "3fa85f64-5717-4562-b3fc-2c963f66afa6", "email"])).toBe("guardians.*.email");
    expect(normaliseIssuePath(undefined)).toBe("(root)");
  });

  it("collapses duplicate paths from details.issues", () => {
    expect(
      issuePathsOf({ issues: [{ path: "terms.0.startDate" }, { path: "terms.1.startDate" }, { path: "yearLabel" }] }),
    ).toEqual(["terms.*.startDate", "yearLabel"]);
    expect(issuePathsOf(undefined)).toEqual([]);
  });

  it("records a 400 with paths and code only, and ignores anything else", () => {
    const details = { issues: [{ path: "terms.0.startDate", message: "First Term must fall within the academic year." }] };
    trackOnboardingServerRejection("school-1", 5, { status: 400, code: "VALIDATION_ERROR", details });
    trackOnboardingServerRejection("school-1", 5, { status: 500, code: "INTERNAL_ERROR" });
    trackOnboardingServerRejection(undefined, 5, { status: 400, code: "VALIDATION_ERROR" });

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("onboarding_step_rejected", {
      schoolId: "school-1",
      step: 5,
      source: "server",
      issuePaths: ["terms.*.startDate"],
      errorCode: "VALIDATION_ERROR",
    });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("must fall within");
  });
});
