import { describe, expect, it } from "vitest";
import { ApiError, ApiNetworkError } from "../api-client";
import { intakeOutcomeUnknown, intakeReviewSummary, validIntakeDate } from "./intake-review";

describe("guided student intake review", () => {
  it("counts only reviewed pending rows and explains per-request boundaries", () => {
    const row = { rowNumber: 1, name: "Ada Example", admissionNumber: "", dateOfBirth: "2012-02-29", gender: "FEMALE", email: "" };
    expect(intakeReviewSummary({ rows: Array.from({ length: 201 }, () => row), alreadySaved: 200, placement: { classLabel: "JSS 2 A", termLabel: "2026/27 — First Term" } })).toEqual({ createCount: 201, requestCount: 2, enrollmentCount: 201, alreadySaved: 200 });
    expect(intakeReviewSummary({ rows: [row], alreadySaved: 0, placement: null }).enrollmentCount).toBe(0);
  });
  it.each([new ApiNetworkError(new Error("lost response")), new ApiError(500, { code: "INTERNAL_ERROR", message: "Failed" }), new Error("Disconnected")])("does not call an uncertain response a rolled-back save", (error) => expect(intakeOutcomeUnknown(error)).toBe(true));
  it.each([400, 401, 403, 409, 422])("a known %i refusal can be handled without guessing a commit", (status) => expect(intakeOutcomeUnknown(new ApiError(status, { code: "REFUSED", message: "Not saved" }))).toBe(false));
  it.each(["2012-02-29", "2013-05-14"])("accepts real calendar date %s", (s) => expect(validIntakeDate(s)).toBe(true));
  it.each(["2013-02-29", "2012-02-31", "31/02/2012", "2012-13-01", "2012-04-31", ""])("rejects rolled or invalid calendar date %s", (s) => expect(validIntakeDate(s)).toBe(false));
});
