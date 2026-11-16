"use client";

import Link from "next/link";
import { ChevronDown, Receipt } from "lucide-react";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

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
  { href: "/finance/dashboard", label: "Overview", exact: true },
  { href: "/finance/fees", label: "Fees", exact: true },
  { href: "/finance/invoices", label: "Invoices" },
  { href: "/finance/debtors", label: "Debtors", exact: true },
];

const MORE_TABS = [
  { href: "/finance/charges", label: "Extra charges", permission: "invoice.issue" },
  { href: "/finance/reminders", label: "Payment reminders", permission: "finance.debtors.remind" },
  { href: "/finance/discounts", label: "Discounts", permission: "discount-rule.read" },
  { href: "/finance/expenses", label: "Expenses", permission: "expense.read" },
  { href: "/finance/payroll", label: "Payroll", permission: "payroll.read" },
] as const;

// "Record payment" lives on the SECTION row, not on the dashboard page.
//
// Two reasons. It applies to every finance page (you can arrive at it from
// Debtors or Invoices just as reasonably as from the dashboard), and putting
// it here means there is exactly ONE of it — #283 shipped a duplicated pair
// of controls by giving a page its own copy of something the shell already
// rendered, and one of the copies had no permission gate at all.
//
// Real destination, real gate, verified rather than assumed:
//   - /finance/payments/record (2026-10-30): find the student, see their
//     unpaid bills, record against one. Before it, this went to the bills
//     list and the bursar had to find the bill first.
//   - payment.record is the permission the API enforces on the mutation, so
//     anyone without it is not shown a button that would 403 on arrival.
//
// Deliberately NOT here: the mockup's "Paystack Sync". Nothing in this
// codebase syncs anything with Paystack on demand — `ensureSchoolPercentageSplit`
// is called during setup, never exposed as an endpoint — so the button would
// name an operation that does not exist. See the note in docs/modules/
// finance-dashboard-pass-3.md for what a real one would need.
//
// Also not here: "Export". It exports the class-level breakdown, which only
// the dashboard has; on this shared row it would appear on six pages with
// nothing to export.
function FinanceSectionActions() {
  const { permissions } = useAuth();

  if (!hasPermission(permissions, "payment.record")) return null;

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            More <ChevronDown className="ml-1 h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {MORE_TABS.filter((item) => hasPermission(permissions, item.permission)).map((item) => (
            <DropdownMenuItem key={item.href} asChild>
              <Link href={item.href}>{item.label}</Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button asChild size="sm">
        <Link href="/finance/payments/record">
          <Receipt className="mr-2 h-4 w-4" aria-hidden />
          Record payment
        </Link>
      </Button>
    </div>
  );
}

export function FinanceSubNav() {
  const tabs = TABS;
  return (
    <SectionTabs ariaLabel="Finance sections" items={tabs} actions={<FinanceSectionActions />} />
  );
}
