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
  actions,
}: {
  items: readonly SectionTabItem[];
  ariaLabel: string;
  onNavigate?: (item: SectionTabItem, active: boolean, e: React.MouseEvent<HTMLAnchorElement>) => void;
  /**
   * Section-level actions, right-aligned on the tab row.
   *
   * OPTIONAL, and omitted by AcademicSubNav and GradingSubNav — this
   * component is shared by three sub-navs and only Finance has actions that
   * belong at section level. Without a slot they would have to live inside
   * each page, which is where the duplicate-control bug of #283 came from.
   */
  actions?: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";

  // Below `lg` the tabs WRAP into rows of rounded buttons (2026-10-12): every
  // section visible and one tap away, nothing past the screen edge. Before,
  // the strip scrolled sideways with nothing to say more tabs were there:
  // "Ex…" and "Subje…" cut mid-word on a phone, and the current tab could be
  // scrolled out of sight. Finance's seven take three rows on a phone.
  //
  // The approved visual direction uses quiet rounded tabs at every width.
  // The existing responsive contract stays: wrap below lg, retain a desktop
  // scrollport as a safety net. One set of links, same route/dirty guards.
  const tabs = (
    <nav aria-label={ariaLabel} className="min-w-0 flex-1 lg:overflow-x-auto">
      <div className="flex flex-wrap gap-2 text-sm lg:min-w-max lg:flex-nowrap">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate ? (e) => onNavigate(item, active, e) : undefined}
              className={cn(
                "sk-section-tab shrink-0 whitespace-nowrap rounded-xl border px-3 py-2 font-semibold transition-colors motion-reduce:transition-none",
                active
                  ? "border-primary/15 bg-primary/10 text-primary"
                  : "border-border/70 bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );

  if (!actions) return tabs;

  // Below xl the actions get their OWN ROW, under the tabs. Side by side at
  // every width meant a phone gave the button about half the row and squeezed
  // the tab scrollport into what was left — "Discounts" rendered cut off
  // mid-word at 430px. Nothing was technically unreachable (the strip still
  // scrolled), which is why the scrollability check in a11y-wave3a passed
  // while the row was barely usable.
  //
  // xl, not lg: at 1024px the admin sidebar leaves roughly 720px, less than
  // seven tabs plus the button. The breakpoint is enforced by measurement in
  // e2e/tests/finance-section-row.spec.ts across 390-1440px, not by this
  // comment.
  return (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:gap-3">
      {tabs}
      <div className="flex shrink-0 items-center justify-end gap-2 xl:pb-1">{actions}</div>
    </div>
  );
}
