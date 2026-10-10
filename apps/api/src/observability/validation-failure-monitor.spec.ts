import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("./sentry", () => ({ Sentry: { captureMessage } }));

import {
  VALIDATION_FAILURE_THRESHOLD,
  VALIDATION_FAILURE_WINDOW_MS,
  ValidationFailureMonitor,
  issueShapes,
} from "./validation-failure-monitor";

// The onboarding step-5 shape (2026-09-11): one route, one field, one refine,
// failing for every owner who changed their year's dates.
const STEP_5 = {
  method: "POST",
  route: "/api/v1/onboarding/academic-calendar",
  errorCode: "VALIDATION_ERROR",
  details: {
    issues: [{ path: "terms.0.startDate", code: "custom", message: "First Term must fall within the academic year." }],
  },
};

describe("ValidationFailureMonitor", () => {
  let clock: number;
  let monitor: ValidationFailureMonitor;

  beforeEach(() => {
    captureMessage.mockReset();
    clock = 1_000_000;
    monitor = new ValidationFailureMonitor(() => clock);
  });

  it("stays silent below the threshold", () => {
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD - 1; i++) monitor.record(STEP_5);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("reports once when one failure repeats, and not again in the same window", () => {
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD * 3; i++) monitor.record(STEP_5);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    const [summary, context] = captureMessage.mock.calls[0];
    expect(summary).toContain("POST /api/v1/onboarding/academic-calendar");
    expect(summary).toContain("terms.*.startDate (custom)");
    expect(context.level).toBe("warning");
    expect(context.fingerprint).toEqual([
      "repeated-validation-failure",
      "POST",
      "/api/v1/onboarding/academic-calendar",
      "VALIDATION_ERROR",
      "terms.*.startDate",
      "custom",
    ]);
  });

  it("reports again in a new window", () => {
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD; i++) monitor.record(STEP_5);
    clock += VALIDATION_FAILURE_WINDOW_MS;
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD; i++) monitor.record(STEP_5);
    expect(captureMessage).toHaveBeenCalledTimes(2);
  });

  it("counts different fields and routes separately", () => {
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD - 1; i++) {
      monitor.record(STEP_5);
      monitor.record({ ...STEP_5, details: { issues: [{ path: "name", code: "too_small" }] } });
      monitor.record({ ...STEP_5, route: "/api/v1/students" });
    }
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("never sends an issue's message, a rejected value or an id", () => {
    const leaky = {
      method: "PATCH",
      route: "/api/v1/students/:id",
      errorCode: "VALIDATION_ERROR",
      details: {
        issues: [
          {
            path: "guardians.3fa85f64-5717-4562-b3fc-2c963f66afa6.email",
            code: "invalid_string",
            message: "Invalid email, received 'adaeze.okafor@example.com'",
          },
        ],
      },
    };
    for (let i = 0; i < VALIDATION_FAILURE_THRESHOLD; i++) monitor.record(leaky);
    const sent = JSON.stringify(captureMessage.mock.calls);
    expect(sent).not.toContain("adaeze");
    expect(sent).not.toContain("3fa85f64");
    expect(sent).not.toContain("received");
    expect(sent).toContain("guardians.*.email");
  });
});

describe("issueShapes", () => {
  it("counts an error with no issues once, under (none)", () => {
    expect(issueShapes(undefined)).toEqual([{ path: "(none)", code: "(none)" }]);
    expect(issueShapes({ issues: [] })).toEqual([{ path: "(none)", code: "(none)" }]);
  });

  it("accepts array paths and collapses duplicate shapes", () => {
    expect(
      issueShapes({
        issues: [
          { path: ["rows", 1, "score"], code: "too_big" },
          { path: ["rows", 7, "score"], code: "too_big" },
        ],
      }),
    ).toEqual([{ path: "rows.*.score", code: "too_big" }]);
  });

  it("refuses a path or code that is not a plain token", () => {
    expect(issueShapes({ issues: [{ path: "a b", code: "x y" }] })).toEqual([{ path: "(other)", code: "(other)" }]);
  });
});
