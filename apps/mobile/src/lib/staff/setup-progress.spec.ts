import { describe, expect, it } from "vitest";

import type { SetupStepDto, SetupStepKey, SetupStepTier } from "@school-kit/types";

import { setupProgress } from "./setup-progress";

function step(key: SetupStepKey, tier: SetupStepTier, done: boolean): SetupStepDto {
  return { key, tier, done, count: done ? 1 : 0, title: `Do ${key}`, why: "because", href: `/${key}`, actionLabel: "Go" };
}

const fullProfile = { logoUrl: "schools/s/logo.png", address: "1 School Rd", phone: "0803", email: "a@b.ng" };
const emptyProfile = { logoUrl: null, address: null, phone: null, email: null };

describe("setupProgress", () => {
  it("counts the checklist's real work and the school's profile together", () => {
    const p = setupProgress(
      [step("students", "required", true), step("enrollments", "required", false), step("staff", "recommended", true)],
      { ...fullProfile, logoUrl: null },
    );
    // 2 of 3 steps + 3 of 4 profile items = 5 of 7.
    expect(p).toMatchObject({ done: 5, total: 7, percent: 71 });
  });

  it("leaves optional steps out, so they never hold the number down", () => {
    const p = setupProgress([step("students", "required", true), step("guardians", "optional", false)], fullProfile);
    expect(p).toMatchObject({ done: 5, total: 5, percent: 100, next: null });
  });

  it("never rounds up to 100 while something is still missing", () => {
    const steps = Array.from({ length: 300 }, (_, i) => step("students", "required", i > 0));
    expect(setupProgress(steps, fullProfile).percent).toBe(99);
  });

  it("points at required work first, then recommended, then the profile", () => {
    expect(
      setupProgress([step("staff", "recommended", false), step("enrollments", "required", false)], emptyProfile).next,
    ).toEqual({ label: "Do enrollments", href: "/enrollments" });
    expect(setupProgress([step("staff", "recommended", true)], emptyProfile).next).toEqual({
      label: "Add your school's logo",
      href: "/settings/school",
    });
  });

  it("treats a blank field as missing", () => {
    expect(setupProgress([], { ...fullProfile, phone: "   " }).next?.label).toBe("Add your school's phone number");
  });
});
