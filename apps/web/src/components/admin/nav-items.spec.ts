import { describe, expect, it } from "vitest";

import { LATER_PHASE_ITEMS, NAV_ITEMS } from "./nav-items";

// Guards on the admin nav.
//
// Two of these exist because of specific mistakes this nav has already made,
// not as generic coverage:
//
//   1. "Lesson Notes" sat under "Coming soon" pointing at /lesson-notes — a
//      route that never existed — while the feature was live in the teacher
//      shell as /teacher/lesson-plans. The nav advertised a page nobody built
//      for a feature that had already shipped.
//   2. nav-items.ts carries a standing comment about a mockup that greyed out
//      Attendance / Report cards / Staff / Communication as "later phases"
//      when all of them were shipped. Greying out a working feature is a
//      functional regression dressed up as a visual change, and a restyle is
//      exactly when it happens.

const SHIPPED_HREFS = [
  "/dashboard",
  "/students",
  "/enrollments",
  "/staff",
  "/report-cards",
  "/finance/dashboard",
  "/settings",
];

describe("admin nav items", () => {
  it("lists Lesson plans as live, pointing at the shell where it actually shipped", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Lesson plans");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    expect(item!.href).toBe("/teacher/lesson-plans");
    // Gated on the permission the API enforces. If a future edit drops or
    // renames this, the item would appear for roles that get a 403 on the
    // page behind it.
    expect(item!.requiredPermission).toBe("lesson-plan.read");
  });

  it("has no reference left to the /lesson-notes route that never existed", () => {
    const all = [...NAV_ITEMS, ...LATER_PHASE_ITEMS];
    expect(all.some((i) => i.href === "/lesson-notes")).toBe(false);
  });

  it("never lists a shipped feature under Coming soon", () => {
    for (const href of SHIPPED_HREFS) {
      expect(LATER_PHASE_ITEMS.some((i) => i.href === href)).toBe(false);
    }
  });

  it("keeps every Coming soon item disabled, and every live item enabled", () => {
    expect(LATER_PHASE_ITEMS.every((i) => !i.enabled)).toBe(true);
    expect(NAV_ITEMS.every((i) => i.enabled)).toBe(true);
  });

  it("uses unique hrefs across both lists", () => {
    const hrefs = [...NAV_ITEMS, ...LATER_PHASE_ITEMS].map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
