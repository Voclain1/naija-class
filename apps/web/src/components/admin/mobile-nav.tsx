"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";
import { Button } from "@/components/ui/button";

import type { NavItem } from "./nav-items";
import { NavList } from "./nav-list";

// Mobile-only equivalent of AdminSidebar — a hamburger trigger (visible only
// below md, matching AdminSidebar's `hidden md:flex`) that opens a slide-in
// drawer with the same NavList. Confirmed gap (2026-07-26 live check): below
// md the sidebar disappears entirely with no replacement, so narrow
// viewports had zero navigation and the topbar's own content overflowed
// rather than reflowing. This closes the navigation half of that gap.
//
// `items`/`laterPhaseItems` pass straight through to NavList (undefined ->
// NavList's own admin defaults) — see nav-list.tsx's header comment. Lets a
// non-admin caller (the teacher portal, via AdminTopbar) supply its own nav
// list instead of silently inheriting admin's.
//
// `open`/`onOpenChange` are a controlled pair (open state now lives in the
// caller, not here — see AdminTopbar's header comment for why: the
// first-login tour needs to force this drawer open/closed from outside on
// mobile, since below `md` there's no persistent sidebar it can spotlight
// directly). EVERY dismiss trigger below — Escape, backdrop click, route
// change, the X button — calls `onOpenChange(false)`, never a local
// setState; whoever owns the state decides what "closed" actually means
// (plain close normally, or "skip the tour" while one is driving this
// drawer — see (admin)/layout.tsx's handler).
export function MobileNav({
  items,
  laterPhaseItems,
  open,
  onOpenChange,
}: {
  items?: NavItem[];
  laterPhaseItems?: NavItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onOpenChange(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Close automatically on route change (tapping a nav link navigates).
  // Intentionally pathname-only: including onOpenChange would close the
  // drawer on every parent re-render (its identity changes often — see
  // AdminTopbar's fallback-vs-controlled setter), not just real navigation.
  useEffect(() => {
    onOpenChange(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => onOpenChange(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => onOpenChange(false)}>
            <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" />
            <div
              className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-lg"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-14 items-center justify-between border-b border-border px-5">
                <SchoolKitWordmark iconSize={26} textClassName="text-base" />
                <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => onOpenChange(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavList
                pathname={pathname}
                onNavigate={() => onOpenChange(false)}
                items={items}
                laterPhaseItems={laterPhaseItems}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
