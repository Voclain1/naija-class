import { describe, expect, it } from "vitest";

import { normaliseSchoolHint, shouldCollapseSchoolField } from "./school-hint";

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

describe("shouldCollapseSchoolField", () => {
  const base = {
    isStudent: true,
    editing: false,
    remembered: "virgo-fidelis",
    current: "virgo-fidelis",
  };

  it("collapses for a returning student on their own device", () => {
    expect(shouldCollapseSchoolField(base)).toBe(true);
  });

  it("shows the field when nothing is remembered", () => {
    // First-ever sign-in, or a wiped/reinstalled app. Collapsing here would
    // hide the field with nothing to put in it.
    expect(shouldCollapseSchoolField({ ...base, remembered: null, current: "" })).toBe(false);
  });

  it("keeps the field open once the user asks to change school", () => {
    // Re-collapsing under someone mid-correction would hide what they are
    // fixing — and they tapped the link precisely because it was wrong.
    expect(shouldCollapseSchoolField({ ...base, editing: true })).toBe(false);
  });

  it("stays open once the typed value diverges from what was remembered", () => {
    // The summary line names the school being signed in to. If it kept
    // showing while a different code was in play, it would be a lie about
    // what is actually going to be submitted.
    expect(shouldCollapseSchoolField({ ...base, editing: true, current: "other-school" })).toBe(
      false,
    );
  });

  it("never collapses on the guardian form", () => {
    // Guardians sign in with an email; there is no school-code field to
    // collapse, and a stray summary line would be nonsense there.
    expect(shouldCollapseSchoolField({ ...base, isStudent: false })).toBe(false);
  });
});
