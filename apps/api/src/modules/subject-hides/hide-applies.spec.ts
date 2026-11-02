import { describe, expect, it } from "vitest";

import { hideApplies, type HideRule } from "@school-kit/types";

// The one rule every results reader uses to decide a hide applies.
const at = {
  termId: "t2",
  academicYearId: "y1",
  termStartDate: "2026-01-05",
  classArmId: "arm-a",
  classLevelId: "lvl-1",
};
const base: HideRule = {
  scope: "ARM",
  classArmId: "arm-a",
  classLevelId: null,
  until: "TERM",
  termId: "t2",
  academicYearId: "y1",
  termStartDate: "2026-01-05",
  unhiddenAt: null,
};

describe("hideApplies", () => {
  it("an arm hide applies to that arm only", () => {
    expect(hideApplies(base, at)).toBe(true);
    expect(hideApplies(base, { ...at, classArmId: "arm-b" })).toBe(false);
  });

  it("a level hide applies to every arm of the level; a school hide to every arm", () => {
    const level: HideRule = { ...base, scope: "LEVEL", classArmId: null, classLevelId: "lvl-1" };
    expect(hideApplies(level, { ...at, classArmId: "arm-b" })).toBe(true);
    expect(hideApplies(level, { ...at, classLevelId: "lvl-2" })).toBe(false);
    expect(hideApplies({ ...base, scope: "SCHOOL", classArmId: null }, { ...at, classLevelId: "lvl-9" })).toBe(true);
  });

  it("a term hide ends with its term; a session hide with its session", () => {
    expect(hideApplies(base, { ...at, termId: "t3" })).toBe(false);
    const year: HideRule = { ...base, until: "YEAR" };
    expect(hideApplies(year, { ...at, termId: "t3" })).toBe(true);
    expect(hideApplies(year, { ...at, termId: "t4", academicYearId: "y2" })).toBe(false);
  });

  it("an indefinite hide applies from its term on, never to earlier terms", () => {
    const forever: HideRule = { ...base, until: "INDEFINITE" };
    expect(hideApplies(forever, { ...at, termId: "t9", academicYearId: "y5", termStartDate: "2030-01-01" })).toBe(true);
    expect(hideApplies(forever, { ...at, termId: "t1", termStartDate: "2025-09-01" })).toBe(false);
  });

  it("an unhidden hide never applies", () => {
    expect(hideApplies({ ...base, unhiddenAt: new Date() }, at)).toBe(false);
  });
});
