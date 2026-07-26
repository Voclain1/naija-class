"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

import { LATER_PHASE_ITEMS, NAV_ITEMS, type NavItem } from "./nav-items";

// Shared between the desktop rail (sidebar.tsx) and the mobile drawer
// (mobile-nav.tsx) — one nav-rendering implementation, two containers.
export function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}

      <div className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        Later phases
      </div>
      {LATER_PHASE_ITEMS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
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
  const baseClasses = "flex items-center gap-3 rounded-md px-3 py-2 text-sm";

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
      className={cn(
        baseClasses,
        active
          ? "bg-primary/10 text-primary"
          : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span>{item.label}</span>
    </Link>
  );
}
