import { describe, expect, it } from "vitest";

import { classLabel } from "./class-label";

describe("classLabel", () => {
  it("shows the arm alone when it already names the level", () => {
    expect(classLabel("JSS 2", "JSS 2 A")).toBe("JSS 2 A");
    expect(classLabel("Primary 4", "primary 4 gold")).toBe("primary 4 gold");
  });

  it("keeps the level when the arm name does not carry it", () => {
    expect(classLabel("JSS 2", "Gold")).toBe("JSS 2 · Gold");
    expect(classLabel("SS 1", "A")).toBe("SS 1 · A");
  });

  it("does not show an empty level", () => {
    expect(classLabel("", "Gold")).toBe("Gold");
  });
});
