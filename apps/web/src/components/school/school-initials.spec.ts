import { describe, expect, it } from "vitest";

import { schoolInitials } from "@school-kit/types";

// The stand-in for a school with no logo on every signed-in surface
// (docs/modules/school-identity.md, slice 1). Lives in @school-kit/types,
// which has no test runner of its own, and is shared by web, portal and app.
describe("schoolInitials", () => {
  it("takes the first two meaningful words", () => {
    expect(schoolInitials("Virgo Fidelis Montessori School")).toBe("VF");
    expect(schoolInitials("Divy Sixth Form College")).toBe("DS");
  });

  it("skips joining words", () => {
    expect(schoolInitials("School of the Nations")).toBe("SN");
    expect(schoolInitials("The Lagos & Ikeja Academy")).toBe("LI");
  });

  it("ignores punctuation and works for one word", () => {
    expect(schoolInitials("St. Mary's")).toBe("SM");
    expect(schoolInitials("chrisland")).toBe("C");
  });

  it("never renders an empty badge", () => {
    expect(schoolInitials("")).toBe("S");
    expect(schoolInitials("  --  ")).toBe("S");
  });
});
