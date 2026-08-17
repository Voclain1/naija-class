import { describe, expect, it } from "vitest";

import { normaliseSchoolHint } from "./school-hint";

describe("normaliseSchoolHint", () => {
  it("returns a clean slug unchanged", () => {
    expect(normaliseSchoolHint("virgo-fidelis")).toBe("virgo-fidelis");
  });

  it("lowercases and trims, matching studentLoginSchema", () => {
    // The server applies .trim().toLowerCase() to schoolSlug. If this drifted
    // from that, a prefilled value could be rejected while looking correct on
    // screen — the child would see nothing wrong with what is in the box.
    expect(normaliseSchoolHint("  Virgo-Fidelis  ")).toBe("virgo-fidelis");
  });

  it("treats an empty or whitespace-only value as no hint", () => {
    // Prefilling "" is indistinguishable from not prefilling, but prefilling
    // "   " looks like a filled field that fails validation.
    expect(normaliseSchoolHint("")).toBeNull();
    expect(normaliseSchoolHint("   ")).toBeNull();
  });

  it("treats a missing value as no hint", () => {
    expect(normaliseSchoolHint(null)).toBeNull();
    expect(normaliseSchoolHint(undefined)).toBeNull();
  });

  it("ignores a non-string, which a corrupted store can return", () => {
    expect(normaliseSchoolHint(42 as unknown as string)).toBeNull();
    expect(normaliseSchoolHint({} as unknown as string)).toBeNull();
  });
});
