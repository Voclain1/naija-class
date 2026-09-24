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
  "/announcements",
  "/guardians",
  "/gradebook",
  "/timetable",
  "/reports",
  "/events",
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

  it("lists Event Calendar as live, gated on the read permission every staff role holds (Phase 8 CP1)", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Event Calendar");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    expect(item!.href).toBe("/events");
    expect(item!.requiredPermission).toBe("calendar-event.read");
    expect(LATER_PHASE_ITEMS.some((i) => i.label === "Event Calendar")).toBe(false);
  });

  it("lists Reports as live, gated on the owner/admin-only completeness permission (Phase 8 CP2)", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Reports");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    expect(item!.href).toBe("/reports");
    expect(item!.requiredPermission).toBe("reports.completeness.read");
    expect(LATER_PHASE_ITEMS.some((i) => i.label === "Reports")).toBe(false);
  });

  it("lists Timetable as live, gated on the owner/admin-only timetable.read (Phase 8 CP3)", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Timetable");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    expect(item!.href).toBe("/timetable");
    expect(item!.requiredPermission).toBe("timetable.read");
    expect(LATER_PHASE_ITEMS.some((i) => i.label === "Timetable")).toBe(false);
  });

  it("lists Gradebook as live, gated on score entry, which owner and admin hold and bursar does not", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Gradebook");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    // The admin route, not the teacher shell's /teacher/gradebook: that page's
    // picker lists only the viewer's own teaching assignments.
    expect(item!.href).toBe("/gradebook");
    expect(item!.requiredPermission).toBe("assessment-score.create");
  });

  it("lists Guardians as live, pointing at the roster, gated on guardian.read", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Guardians");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    // The roster itself — not /guardians/import, which is how parents are
    // added, not where a school sees who can get into the portal.
    expect(item!.href).toBe("/guardians");
    expect(item!.requiredPermission).toBe("guardian.read");
  });

  it("lists Announcements as live, gated on the SEND permission rather than read", () => {
    const item = NAV_ITEMS.find((i) => i.label === "Announcements");
    expect(item).toBeDefined();
    expect(item!.enabled).toBe(true);
    expect(item!.href).toBe("/announcements");
    // Every staff role reads announcements; only owner/admin send them, and
    // this page is the sending desk. Gating on announcement.read would show a
    // teacher and a bursar a compose form the API refuses.
    expect(item!.requiredPermission).toBe("announcement.create");
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
