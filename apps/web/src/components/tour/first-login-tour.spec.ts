import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "../admin/nav-items";
import { buildTourSteps, TOUR_SCHOOL_TARGET } from "./first-login-tour";

// The tour went stale once (deferred.md, 2026-10-11): it still walked the menu
// as it stood in September. These keep it honest about the shell it tours.
describe("buildTourSteps", () => {
  const steps = buildTourSteps("Virgo Fidelis Montessori School");

  it("points every spotlight at something that exists: a live menu item or the school's name", () => {
    const live = new Set(NAV_ITEMS.filter((i) => i.enabled).map((i) => i.href));
    for (const step of steps) {
      if (step.kind !== "spot") continue;
      expect(step.target === TOUR_SCHOOL_TARGET || live.has(step.target), step.target).toBe(true);
    }
  });

  it("opens with a welcome, names the school, and closes with the way back in", () => {
    expect(steps[0]).toMatchObject({ kind: "intro", title: "Welcome to SchoolKit" });
    expect(steps[0]!.body).toContain("Virgo Fidelis Montessori School");
    expect(steps.at(-1)).toMatchObject({ kind: "outro" });
    expect(steps.at(-1)!.body).toContain("Settings → School");
  });

  it("reads sensibly before the school has loaded", () => {
    expect(buildTourSteps(null)[0]!.body).toContain("your school's home");
  });
});
