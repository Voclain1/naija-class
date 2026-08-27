import { describe, expect, it } from "vitest";

import { currentSuffix, unambiguousCurrent } from "./current-context";

describe("unambiguousCurrent", () => {
  it("returns the single record flagged current", () => {
    const years = [
      { id: "a", isCurrent: false },
      { id: "b", isCurrent: true },
      { id: "c", isCurrent: false },
    ];
    expect(unambiguousCurrent(years)?.id).toBe("b");
  });

  it("returns null when nothing is flagged current, leaving the user in control", () => {
    expect(unambiguousCurrent([{ id: "a", isCurrent: false }])).toBeNull();
    expect(unambiguousCurrent([])).toBeNull();
  });

  it("returns null when the data is ambiguous rather than guessing one", () => {
    // Two current years is a data problem. Silently picking one would hide it
    // behind a screen that looks like it worked.
    const ambiguous = [
      { id: "a", isCurrent: true },
      { id: "b", isCurrent: true },
    ];
    expect(unambiguousCurrent(ambiguous)).toBeNull();
  });
});

describe("currentSuffix", () => {
  it("marks the school's current record in the dropdown", () => {
    expect(currentSuffix(true)).toBe(" (current)");
    expect(currentSuffix(false)).toBe("");
  });
});
