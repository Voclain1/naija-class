import { describe, expect, it } from "vitest";

import { importMappingErrorMessage } from "./mapping-error-copy";

describe("importMappingErrorMessage", () => {
  it("keeps a known mapping error actionable without exposing its code", () => {
    const error = {
      code: "MISSING_REQUIRED_MAPPING",
      message: "MISSING_REQUIRED_MAPPING: lastName",
    };

    expect(importMappingErrorMessage(error)).toBe(
      "Choose a column for each required field before continuing.",
    );
  });

  it("does not expose an unexpected backend message", () => {
    expect(importMappingErrorMessage(new Error("uuid=1234"))).toBe(
      "We couldn’t save the column mapping. Review your selections and try again.",
    );
  });
});
