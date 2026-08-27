import { describe, expect, it } from "vitest";

import { ApiError } from "../api-client";
import { financeErrorMessage } from "./error-copy";

// F-12 regression suite: no error CLASS NAME, stack, or raw object text may
// ever reach a finance screen. `String(e)` produced exactly that.

describe("financeErrorMessage", () => {
  it("never leaks 'ApiError:' or 'TypeError:' into user-facing copy", () => {
    const cases: unknown[] = [
      new ApiError(500, { code: "INTERNAL", message: "Unhandled exception at line 42" }),
      new TypeError("Failed to fetch"),
      new Error("connect ECONNREFUSED 127.0.0.1:4000"),
      { weird: "not an error at all" },
      undefined,
      null,
    ];

    for (const thrown of cases) {
      const message = financeErrorMessage(thrown);
      expect(message).not.toContain("ApiError");
      expect(message).not.toContain("TypeError");
      expect(message).not.toContain("Error:");
      expect(message).not.toContain("ECONNREFUSED");
      expect(message).not.toContain("line 42");
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it("passes through a reviewed 4xx message from our own API", () => {
    // These are written for humans in the service layer and are the single
    // most useful thing to show — e.g. why a cancel was refused.
    const conflict = new ApiError(409, {
      code: "INVOICE_HAS_PAYMENTS",
      message: "Cannot cancel an invoice that has recorded payments.",
    });
    expect(financeErrorMessage(conflict)).toBe(
      "Cannot cancel an invoice that has recorded payments.",
    );
  });

  it("does not show a bare error code as if it were a sentence", () => {
    const codeOnly = new ApiError(400, {
      code: "VALIDATION_FAILED",
      message: "VALIDATION_FAILED",
    });
    expect(financeErrorMessage(codeOnly)).not.toBe("VALIDATION_FAILED");
  });

  it("explains a permission problem in terms of what to do next", () => {
    const forbidden = new ApiError(403, { code: "FORBIDDEN", message: "Forbidden" });
    expect(financeErrorMessage(forbidden)).toContain("permission");
    expect(financeErrorMessage(forbidden)).toContain("administrator");
  });

  it("tells the user to check their connection when the request never reached the API", () => {
    expect(financeErrorMessage(new TypeError("Failed to fetch"))).toContain(
      "internet connection",
    );
  });

  it("does not blame the user for a 5xx", () => {
    const serverError = new ApiError(503, { code: "UNAVAILABLE", message: "upstream down" });
    expect(financeErrorMessage(serverError)).toContain("our side");
  });
});
