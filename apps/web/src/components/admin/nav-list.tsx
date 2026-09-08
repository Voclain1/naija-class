"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { LATER_PHASE_ITEMS, NAV_ITEMS, type NavItem } from "./nav-items";

// Shared between the desktop rail (sidebar.tsx) and the mobile drawer
// (mobile-nav.tsx) — one nav-rendering implementation, two containers.
//
// `items`/`laterPhaseItems` default to the admin nav (NAV_ITEMS/
// LATER_PHASE_ITEMS) so every existing admin call site (AdminSidebar,
// MobileNav via AdminTopbar) keeps rendering exactly as before with no
// props passed. The teacher portal passes its own list explicitly instead —
// see components/teacher/sidebar.tsx's useTeacherNavItems() and
// components/teacher/topbar.tsx. Previously this was hardcoded to the admin
// list unconditionally, so a teacher's mobile hamburger drawer showed
// admin's Students/Staff/Finance/Settings instead of their own nav (see
// docs/deferred.md "Teacher portal mobile nav shows admin items").
export function NavList({
  pathname,
  onNavigate,
  items = NAV_ITEMS,
  laterPhaseItems = LATER_PHASE_ITEMS,
}: {
  pathname: string;
  onNavigate?: () => void;
  items?: NavItem[];
  laterPhaseItems?: NavItem[];
}) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {items.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}

      {laterPhaseItems.length > 0 && (
        <>
          <div className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Coming soon
          </div>
          {laterPhaseItems.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </>
      )}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const active = item.enabled && (pathname === item.href || pathname.startsWith(`${item.href}/`));
  // Nav labels sit at font-medium, one step above the previous default
  // weight — the single deliberate typography change in the dashboard
  // redesign (brand faces themselves are unchanged: Hanken Grotesk +
  // Fraunces stay, the mockup's Newsreader/Plus Jakarta Sans were rejected).
  // The active item goes one step further to font-semibold so the current
  // page still reads as distinct now that everything around it is heavier.
  //
  // Set HERE, in the one shared NavLink, rather than per container: this
  // component backs the desktop rail, the mobile drawer AND the teacher
  // portal's sidebar, so a per-call-site weight would drift between them.
  const baseClasses = "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium";

  if (!item.enabled) {
    return (
      <span
        className={cn(baseClasses, "cursor-not-allowed text-muted-foreground/60")}
        title="Coming soon"
        aria-disabled="true"
      >
        <Icon className="h-4 w-4" />
        <span>{item.label}</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      data-tour-target={item.href}
      className={cn(
        baseClasses,
        active
          ? "bg-primary/10 font-semibold text-primary"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}
