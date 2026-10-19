import type { NavItem } from "./nav-items";

// Menu families (2026-10-19, the owner's request: "too many menu items …
// group them according to relevance, like a family … easier for a
// non-technical user to navigate without getting stuck or lost").
//
// A family is what a member of staff would call the work, not how the code is
// organised: the classes a pupil sits in, the money, the school's own
// services. Each item names its family in nav-items.ts (`group`); NavList
// (nav-list.tsx) folds them into sections that open and close.
//
// Rules the menu keeps, so a short menu never turns into a maze:
//   * A person who can see few pages (a librarian, a bursar) gets a plain list,
//     no sections: FLAT_MENU_MAX below.
//   * A family with one visible page is not a section: the page shows on its
//     own, with nothing to open.
//   * The section holding the page you are on is always open.
export const NAV_GROUP_LABELS = {
  people: "People",
  teaching: "Teaching",
  results: "Exams & results",
  care: "Student care",
  services: "School services",
  money: "Money",
  communication: "Messages & events",
  reports: "Reports & insights",
  setup: "School setup",
  // Teacher portal families.
  "my-classes": "My classes",
  lessons: "Lessons",
  school: "School",
} as const;

export type NavGroupKey = keyof typeof NAV_GROUP_LABELS;

/** At or below this many pages, the menu is a plain list with no sections. */
export const FLAT_MENU_MAX = 8;

export type NavBlock =
  | { kind: "item"; item: NavItem }
  | { kind: "group"; key: NavGroupKey; label: string; items: NavItem[] };

/**
 * The menu's shape for one person: items grouped by family, in the order each
 * family first appears. An item with no family keeps its place.
 */
export function buildNavBlocks(items: NavItem[]): NavBlock[] {
  if (items.length <= FLAT_MENU_MAX) return items.map((item) => ({ kind: "item", item }));
  const blocks: NavBlock[] = [];
  const byKey = new Map<NavGroupKey, Extract<NavBlock, { kind: "group" }>>();
  for (const item of items) {
    if (!item.group) {
      blocks.push({ kind: "item", item });
      continue;
    }
    let block = byKey.get(item.group);
    if (!block) {
      block = { kind: "group", key: item.group, label: NAV_GROUP_LABELS[item.group], items: [] };
      byKey.set(item.group, block);
      blocks.push(block);
    }
    block.items.push(item);
  }
  // A family of one is just a page.
  return blocks.map((b) => (b.kind === "group" && b.items.length === 1 ? { kind: "item", item: b.items[0]! } : b));
}

/**
 * The item for the page you are on: the longest href that the path starts
 * with, so /report-cards/pins lights Result Checker and not Report Cards too,
 * and /teacher/attendance/subject lights Subject attendance alone.
 */
export function activeHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!item.enabled) continue;
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}

/** Plain words someone might type to find a page ("fees", "parents"). */
export function matchesNavSearch(item: NavItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const group = item.group ? NAV_GROUP_LABELS[item.group] : "";
  return [item.label, group, ...(item.keywords ?? [])].some((w) => w.toLowerCase().includes(q));
}
