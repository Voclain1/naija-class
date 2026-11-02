import { describe, expect, it } from "vitest";

import { SUBJECT_CATALOGUE, catalogueKeys, subjectMatchKey } from "@school-kit/db";

describe("SUBJECT_CATALOGUE", () => {
  it("gives every subject a unique code and at least one stage", () => {
    const codes = SUBJECT_CATALOGUE.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of SUBJECT_CATALOGUE) expect(s.stages.length).toBeGreaterThan(0);
  });

  it("never lets one name match two subjects", () => {
    const owner = new Map<string, string>();
    for (const s of SUBJECT_CATALOGUE) {
      for (const key of catalogueKeys(s)) {
        expect(owner.get(key) ?? s.code, `"${key}" matches both ${owner.get(key)} and ${s.code}`).toBe(s.code);
        owner.set(key, s.code);
      }
    }
  });

  it("covers every stage", () => {
    for (const stage of ["NURSERY", "KG", "PRIMARY", "JSS", "SSS"] as const) {
      expect(SUBJECT_CATALOGUE.filter((s) => s.stages.includes(stage)).length, stage).toBeGreaterThan(5);
    }
  });

  it("matches a school's own spelling", () => {
    expect(subjectMatchKey("Maths ")).toBe("maths");
    expect(subjectMatchKey("C.R.S")).toBe("crs");
  });
});
