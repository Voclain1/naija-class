"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";

// Sub-nav for /finance/*. Mirrors settings/grading and settings/academic's
// sub-nav pattern (now shared via SectionTabs). All five pages already
// existed and worked — they were simply unreachable except by typing the URL
// directly (the top-level "Finance" sidebar item only ever linked to
// /finance/dashboard). This adds no new pages, only makes the existing ones
// navigable.
const TABS: SectionTabItem[] = [
  { href: "/finance/dashboard", label: "Dashboard", exact: true },
  { href: "/finance/invoices", label: "Invoices" },
  { href: "/finance/debtors", label: "Debtors", exact: true },
  { href: "/finance/expenses", label: "Expenses", exact: true },
  { href: "/finance/payroll", label: "Payroll", exact: true },
];

export function FinanceSubNav() {
  return <SectionTabs ariaLabel="Finance sections" items={TABS} />;
}
