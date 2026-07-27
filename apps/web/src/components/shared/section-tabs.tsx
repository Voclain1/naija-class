"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// FinanceSubNav, AcademicSubNav, and GradingSubNav were three near-identical
// hand-rolled link-tab bars (same underline-tab markup, same active-state
// logic), styled with plain ink (`border-foreground`/`text-foreground`)
// rather than the brand's primary emerald the way the sidebar's own active
// state (`bg-primary/10 text-primary` in nav-list.tsx) and the new Tabs
// primitive (`data-[state=active]:border-primary`) both use. This is a route
// sub-nav (each tab navigates to a different page), not a same-page content
// switcher — that's why it's plain <Link>-based rather than built on the
// Radix Tabs primitive in components/ui/tabs.tsx, which assumes co-located
// TabsContent panels.
export interface SectionTabItem {
  href: string;
  label: string;
  /** true = active only on exact match; false/omitted = active for the href and any sub-path. */
  exact?: boolean;
}

export function SectionTabs({
  items,
  ariaLabel,
  onNavigate,
}: {
  items: readonly SectionTabItem[];
  ariaLabel: string;
  onNavigate?: (item: SectionTabItem, active: boolean, e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label={ariaLabel} className="flex gap-1 border-b border-border text-sm">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate ? (e) => onNavigate(item, active, e) : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 font-medium transition-colors",
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
