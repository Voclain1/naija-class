import { describe, expect, it } from "vitest";

import { parsePreference, resolveScheme, THEME_PREFERENCES } from "./preference";

// Which theme renders (docs/modules/look-and-feel.md Part 3).
//
// Pure, because the interesting part is a rule rather than a widget: "system"
// has to mean the phone, an explicit choice has to beat the phone, and an OS
// that says nothing must not be read as a request for dark.

describe("resolveScheme", () => {
  it("follows the phone when the preference is system", () => {
    expect(resolveScheme("system", "dark")).toBe("dark");
    expect(resolveScheme("system", "light")).toBe("light");
  });

  it("overrides the phone when a person has chosen", () => {
    // The whole point of the setting: someone reading in bed with the handset
    // on light, or in sunlight with it on dark.
    expect(resolveScheme("light", "dark")).toBe("light");
    expect(resolveScheme("dark", "light")).toBe("dark");
  });

  it("treats an unknown OS answer as light, never dark", () => {
    // useColorScheme() returns null when the platform has no answer. Guessing
    // dark there would flip the whole app on a device that never asked.
    expect(resolveScheme("system", null)).toBe("light");
    expect(resolveScheme("system", undefined)).toBe("light");
    // "unspecified" is a real value in React Native's ColorSchemeName — the
    // first version of this function did not allow it and failed typecheck.
    expect(resolveScheme("system", "unspecified")).toBe("light");
  });

  it("falls back to following the phone when nothing is stored yet", () => {
    // A fresh install behaves exactly as the app did before it had a choice.
    expect(resolveScheme(null, "dark")).toBe("dark");
    expect(resolveScheme(null, "light")).toBe("light");
  });
});

describe("parsePreference", () => {
  it("accepts the three real values", () => {
    for (const value of THEME_PREFERENCES) {
      expect(parsePreference(value)).toBe(value);
    }
  });

  it("treats anything else as system rather than throwing", () => {
    // Storage can hold whatever an older build wrote, or nothing at all. A
    // colour scheme is not worth a crash on launch.
    expect(parsePreference(null)).toBe("system");
    expect(parsePreference("")).toBe("system");
    expect(parsePreference("midnight")).toBe("system");
  });
});
