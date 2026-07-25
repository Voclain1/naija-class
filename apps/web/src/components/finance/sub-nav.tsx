"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Sub-nav for /finance/*. Mirrors settings/grading and settings/academic's
// sub-nav pattern. All five pages already existed and worked — they were
// simply unreachable except by typing the URL directly (the top-level
// "Finance" sidebar item only ever linked to /finance/dashboard). This adds
// no new pages, only makes the existing ones navigable.
const TABS = [
  { href: "/finance/dashboard", label: "Dashboard", exact: true },
  { href: "/finance/invoices", label: "Invoices", exact: false },
  { href: "/finance/debtors", label: "Debtors", exact: true },
  { href: "/finance/expenses", label: "Expenses", exact: true },
  { href: "/finance/payroll", label: "Payroll", exact: true },
] as const;

export function FinanceSubNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Finance sections" className="flex gap-1 border-b text-sm">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "px-3 py-2 border-b-2 -mb-px transition-colors",
              active
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
