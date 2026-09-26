import { describe, expect, it } from "vitest";

import { callSchoolHref } from "@school-kit/types";

// "Call the school" (docs/modules/the-school-day.md D12). The whole of Part D's
// logic, and worth pinning because every case here is a real phone field.
//
// The helper lives in @school-kit/types because web, portal and mobile all
// need the same rule; the SPEC lives here because packages/types has no test
// runner of its own. Same arrangement as the month-grid helpers.

describe("callSchoolHref", () => {
  it("strips whatever a human typed around the digits", () => {
    expect(callSchoolHref("0803 123 4567")).toBe("tel:08031234567");
    expect(callSchoolHref("(080) 3123-4567")).toBe("tel:08031234567");
    expect(callSchoolHref("  08031234567  ")).toBe("tel:08031234567");
  });

  it("keeps a leading + — dropping it dials a different country", () => {
    expect(callSchoolHref("+234 803 123 4567")).toBe("tel:+2348031234567");
  });

  it("returns null when there is nothing to ring, so the button is HIDDEN", () => {
    // Not a disabled button: a greyed-out "Call the school" tells a worried
    // parent the feature exists and has been taken from them.
    expect(callSchoolHref(null)).toBeNull();
    expect(callSchoolHref(undefined)).toBeNull();
    expect(callSchoolHref("")).toBeNull();
    expect(callSchoolHref("   ")).toBeNull();
  });

  it("refuses a number too short to be one", () => {
    expect(callSchoolHref("123")).toBeNull();
    expect(callSchoolHref("n/a")).toBeNull();
  });
});
