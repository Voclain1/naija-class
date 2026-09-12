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

  // The strip scrolls horizontally rather than being clipped. A plain flex row
  // neither wrapped nor scrolled, so once the tabs were wider than the viewport
  // (Finance has seven) the overflowing ones were cut off by the admin shell's
  // `overflow-x-hidden` <main> and became genuinely unreachable — not
  // scrollable to, not clickable, yet still keyboard-focusable into off-screen
  // space. Measured at 768px on /finance/invoices.
  //
  // The scrollport is the <nav> and the flex row moves inside it: a container
  // with `overflow-x: auto` computes `overflow-y` to `auto` as well, so putting
  // the scroll on the bordered row itself would clip each tab's `-mb-px`
  // underline. `min-w-max` lets that row stay wider than the scrollport.
  // The actions sit BESIDE the scrollport, not inside it: they must stay
  // reachable when the seven finance tabs overflow, and a primary action that
  // scrolls off-screen is the same unreachable-control bug the scrollport
  // below was added to fix.
  const tabs = (
    <nav aria-label={ariaLabel} className="min-w-0 flex-1 overflow-x-auto">
      <div className="flex min-w-max gap-1 border-b border-border text-sm">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate ? (e) => onNavigate(item, active, e) : undefined}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-muted hover:text-foreground",
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

  return (
    <div className="flex items-end gap-3">
      {tabs}
      <div className="flex shrink-0 items-center gap-2 pb-1">{actions}</div>
    </div>
  );
}
