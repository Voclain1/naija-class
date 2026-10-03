import { describe, expect, it } from "vitest";

import { ApiError, ApiNetworkError } from "../api/client";
import { isResultLocked } from "./result-lock";

describe("isResultLocked (Phase 8c / CP6b)", () => {
  it("is the PIN case and only the PIN case", () => {
    expect(isResultLocked(new ApiError(403, { code: "RESULT_LOCKED", message: "x" }))).toBe(true);
    // A guardian refused for another family's child is NOT a PIN prompt.
    expect(isResultLocked(new ApiError(403, { code: "FORBIDDEN", message: "x" }))).toBe(false);
    expect(isResultLocked(new ApiError(404, { code: "NOT_FOUND", message: "x" }))).toBe(false);
    expect(isResultLocked(new ApiNetworkError("offline"))).toBe(false);
    expect(isResultLocked(undefined)).toBe(false);
  });
});
