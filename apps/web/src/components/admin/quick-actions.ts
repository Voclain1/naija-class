import type { NavItem } from "./nav-items";

// The topbar's A/B quick actions.
//
// Pure resolver, kept out of the component so the permission behaviour is
// unit-testable — apps/web has no DOM test setup by deliberate choice (see
// vitest.config.ts), so anything with real branching lives here with a
// sibling .spec.ts.
//
// THE GATE IS DERIVED, NOT RE-IMPLEMENTED. The Ledger pill is emitted only if
// the Finance entry survives useVisibleAdminNavItems()' permission filtering,
// which means it inherits `finance.dashboard.read` automatically. Writing a
// second `hasPermission(permissions, "finance.dashboard.read")` check here
// would be a copy that can drift from the nav item's — and a bursar-adjacent
// role that lost finance access would keep a visible button that 403s.
//
// It also takes the HREF from that item rather than hardcoding
// "/finance/dashboard", so if Finance ever moves, the pill moves with it.

/** The href the Finance nav entry uses. Matched, never assumed to be present. */
export const LEDGER_NAV_HREF = "/finance/dashboard";

export interface QuickAction {
  key: "command" | "ledger";
  /** The letter shown in the pill's badge. */
  badge: string;
  /**
   * The accessible name. Deliberately descriptive rather than "A"/"B": a
   * one-letter accessible name is useless to a screen reader, and short names
   * are exactly what collide under Playwright's substring matching — an
   * aria-label collision has already broken the a11y suite once this cycle
   * (the trajectory chart's name contained the term <select>'s "Term").
   *
   * Verified against the existing e2e suite: no getByLabel call uses
   * "command", "ledger" or "finance", so these two introduce no collision.
   */
  label: string;
  /** Visible pill text. */
  text: string;
  /** Present for navigation actions only; the command action opens a dialog. */
  href?: string;
}

export function resolveQuickActions(visibleNavItems: NavItem[]): QuickAction[] {
  const actions: QuickAction[] = [
    {
      key: "command",
      badge: "A",
      label: "Open command palette",
      text: "Command",
    },
  ];

  // Only if the user can actually reach Finance.
  const ledger = visibleNavItems.find((i) => i.href === LEDGER_NAV_HREF && i.enabled);
  if (ledger) {
    actions.push({
      key: "ledger",
      badge: "B",
      label: "Go to finance ledger",
      text: "Ledger",
      href: ledger.href,
    });
  }

  return actions;
}
