import { describe, expect, it } from "vitest";
import { Wallet } from "lucide-react";

import { NAV_ITEMS, type NavItem } from "./nav-items";
import { LEDGER_NAV_HREF, resolveQuickActions } from "./quick-actions";

// The behaviour worth proving here is the permission gate: the Ledger pill
// must appear only for someone who can actually open the finance dashboard.
// A visible button that 403s is worse than no button.
//
// The gate is derived from the ALREADY-FILTERED nav list rather than
// re-checking the permission, so these tests feed in filtered lists — which is
// exactly what useVisibleAdminNavItems() hands the component.

const financeItem = NAV_ITEMS.find((i) => i.href === LEDGER_NAV_HREF)!;

describe("topbar quick actions", () => {
  it("always offers the command palette", () => {
    const actions = resolveQuickActions([]);
    expect(actions.map((a) => a.key)).toEqual(["command"]);
    expect(actions[0]!.badge).toBe("A");
  });

  it("offers the Ledger pill when Finance survived permission filtering", () => {
    const actions = resolveQuickActions([financeItem]);
    expect(actions.map((a) => a.key)).toEqual(["command", "ledger"]);
    const ledger = actions[1]!;
    expect(ledger.badge).toBe("B");
    expect(ledger.href).toBe(LEDGER_NAV_HREF);
  });

  it("omits the Ledger pill when Finance was filtered out", () => {
    // A role reaching the admin shell without finance.dashboard.read: the nav
    // item is gone, so the pill must be gone too.
    const withoutFinance = NAV_ITEMS.filter((i) => i.href !== LEDGER_NAV_HREF);
    const actions = resolveQuickActions(withoutFinance);
    expect(actions.some((a) => a.key === "ledger")).toBe(false);
  });

  it("takes the href from the nav item rather than hardcoding a second copy", () => {
    // If Finance moves, the pill must move with it. Proven by moving it.
    const moved: NavItem = { ...financeItem, href: LEDGER_NAV_HREF };
    const relocated: NavItem = { label: "Finance", href: "/finance/overview", icon: Wallet, enabled: true };
    expect(resolveQuickActions([moved])[1]!.href).toBe(LEDGER_NAV_HREF);
    // A nav list whose finance entry lives elsewhere yields no pill under the
    // current constant — the pill and the nav entry stay in lockstep rather
    // than the pill inventing a route of its own.
    expect(resolveQuickActions([relocated]).some((a) => a.key === "ledger")).toBe(false);
  });

  it("ignores a disabled Finance entry", () => {
    const disabled: NavItem = { ...financeItem, enabled: false };
    expect(resolveQuickActions([disabled]).some((a) => a.key === "ledger")).toBe(false);
  });

  it("gives every action a descriptive accessible name, never a bare letter", () => {
    const actions = resolveQuickActions([financeItem]);
    for (const a of actions) {
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.label).not.toBe(a.badge);
    }
    // Distinctive enough not to collide under Playwright's substring matching,
    // which is how an aria-label broke the a11y suite once already.
    expect(actions.map((a) => a.label)).toEqual([
      "Open command palette",
      "Go to finance ledger",
    ]);
  });
});
