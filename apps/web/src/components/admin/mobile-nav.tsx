"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

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
export function MobileNav({
  items,
  laterPhaseItems,
}: {
  items?: NavItem[];
  laterPhaseItems?: NavItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Close automatically on route change (tapping a nav link navigates).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex md:hidden" onClick={() => setOpen(false)}>
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
                <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <NavList
                pathname={pathname}
                onNavigate={() => setOpen(false)}
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
