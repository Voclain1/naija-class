import { describe, expect, it } from "vitest";

import { newSubjectCode } from "./subject-code";

describe("newSubjectCode", () => {
  it("makes a valid code from a name", () => {
    expect(newSubjectCode("Diction & Elocution", [])).toBe("diction-elocution");
    expect(newSubjectCode("  !!!  ", [])).toBe("subject");
  });

  it("keeps to 20 characters without a trailing hyphen", () => {
    const code = newSubjectCode("Entrepreneurship and Trade Studies", []);
    expect(code.length).toBeLessThanOrEqual(20);
    expect(code).toMatch(/^[a-z0-9-]+$/);
    expect(code.endsWith("-")).toBe(false);
  });

  it("never reuses a code the school already has", () => {
    expect(newSubjectCode("Music", ["music"])).toBe("music-2");
    expect(newSubjectCode("Music", ["music", "music-2"])).toBe("music-3");
    const long = newSubjectCode("Entrepreneurship Studies", ["entrepreneurship-st"]);
    expect(long).not.toBe("entrepreneurship-st");
    expect(long.length).toBeLessThanOrEqual(20);
  });
});
