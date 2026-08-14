"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";

// Sub-nav for /finance/*. Mirrors settings/grading and settings/academic's
// sub-nav pattern (now shared via SectionTabs). All five pages already
// existed and worked — they were simply unreachable except by typing the URL
// directly (the top-level "Finance" sidebar item only ever linked to
// /finance/dashboard). This adds no new pages, only makes the existing ones
// navigable.
//
// Fee Catalog and Discounts added 2026-08-14, same category of fix. Both
// pages shipped in Phase 3 under /settings/finance/* and were reachable only
// from the Settings hub — which `bursar` never sees, because the Settings
// sidebar item is gated on `school.read` and PHASE_3_BURSAR_PERMISSIONS does
// not include it. Bursar holds full fee-category.*, fee-item.* and
// discount-rule.* CRUD, so the one role whose job this is had no nav path to
// either page. They are finance operations data (what the school charges),
// not school configuration, so they belong here; ordering puts them after
// Debtors — the collect-money tabs first, then what drives the amounts.
// /settings/finance/fees and /settings/finance/discounts now redirect here,
// and the Settings hub keeps its two cards, repointed at these URLs.
//
// /settings/finance/payments stays in Settings: it's Paystack credentials
// (a school-configuration concern), not fee data.
const TABS: SectionTabItem[] = [
  { href: "/finance/dashboard", label: "Dashboard", exact: true },
  { href: "/finance/invoices", label: "Invoices" },
  { href: "/finance/debtors", label: "Debtors", exact: true },
  { href: "/finance/fees", label: "Fee Catalog", exact: true },
  { href: "/finance/discounts", label: "Discounts", exact: true },
  { href: "/finance/expenses", label: "Expenses", exact: true },
  { href: "/finance/payroll", label: "Payroll", exact: true },
];

export function FinanceSubNav() {
  return <SectionTabs ariaLabel="Finance sections" items={TABS} />;
}
