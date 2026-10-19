import { describe, expect, it } from "vitest";

import { activeHref, buildNavBlocks, FLAT_MENU_MAX, matchesNavSearch, NAV_GROUP_LABELS } from "./nav-groups";
import { NAV_ITEMS, type NavItem } from "./nav-items";

// The menu families (nav-groups.ts, 2026-10-19). What a member of staff
// relies on: every page has a home, a short menu is never a maze, and the
// page you are on is lit exactly once.

describe("admin menu families", () => {
  it("puts every admin page in a family, except Dashboard and My profile", () => {
    for (const item of NAV_ITEMS) {
      if (item.href === "/dashboard" || item.href === "/settings/profile") expect(item.group).toBeUndefined();
      else expect(item.group, item.label).toBeDefined();
    }
  });

  it("folds the full owner menu into sections, Dashboard first", () => {
    const blocks = buildNavBlocks(NAV_ITEMS);
    expect(blocks[0]).toMatchObject({ kind: "item", item: { href: "/dashboard" } });
    const sections = blocks.filter((b) => b.kind === "group").map((b) => b.label);
    expect(sections).toEqual([
      "People",
      "Teaching",
      "Exams & results",
      "Student care",
      "School services",
      "Messages & events",
      "Reports & insights",
      "School setup",
    ]);
    // Money holds one page (Finance has its own tabs), so it is not a section.
    expect(blocks).toContainEqual({ kind: "item", item: expect.objectContaining({ href: "/finance/dashboard" }) });
  });

  it("keeps every page reachable: each one is in exactly one block", () => {
    const blocks = buildNavBlocks(NAV_ITEMS);
    const hrefs = blocks.flatMap((b) => (b.kind === "item" ? [b.item.href] : b.items.map((i) => i.href)));
    expect(hrefs.sort()).toEqual(NAV_ITEMS.map((i) => i.href).sort());
  });

  it("gives a short menu (a librarian's, a bursar's) as a plain list", () => {
    const few = NAV_ITEMS.slice(0, FLAT_MENU_MAX);
    expect(buildNavBlocks(few).every((b) => b.kind === "item")).toBe(true);
  });

  it("lights the longest matching page only", () => {
    expect(activeHref(NAV_ITEMS, "/report-cards/pins")).toBe("/report-cards/pins");
    expect(activeHref(NAV_ITEMS, "/report-cards/abc")).toBe("/report-cards");
    expect(activeHref(NAV_ITEMS, "/settings/grading/edit")).toBe("/settings/grading");
    expect(activeHref(NAV_ITEMS, "/settings/school")).toBe("/settings");
    expect(activeHref(NAV_ITEMS, "/nowhere")).toBeNull();
  });

  it("finds pages by everyday words as well as their names", () => {
    const find = (q: string) => NAV_ITEMS.filter((i) => matchesNavSearch(i, q)).map((i) => i.label);
    expect(find("fees")).toContain("Finance");
    expect(find("parents")).toContain("Guardians");
    expect(find("salary")).toContain("Finance");
    expect(find("exeat")).toContain("Boarding");
    expect(find("STUDENT CARE")).toEqual(["Behaviour", "Health", "Sickbay"]);
  });

  it("labels every family it uses", () => {
    const item = (group: NavItem["group"]): NavItem => ({ ...NAV_ITEMS[1]!, href: `/${group}`, group });
    for (const key of Object.keys(NAV_GROUP_LABELS) as NavItem["group"][]) {
      expect(NAV_GROUP_LABELS[key!]).toBeTruthy();
      expect(matchesNavSearch(item(key), NAV_GROUP_LABELS[key!])).toBe(true);
    }
  });
});
