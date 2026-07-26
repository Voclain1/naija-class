"use client";

import { usePathname } from "next/navigation";

import { NavList } from "./nav-list";

// Desktop-only persistent rail — hidden below md. Below md, mobile-nav.tsx's
// hamburger + drawer is the equivalent navigation surface (see topbar.tsx).
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-border px-5 font-serif text-lg font-medium text-foreground">
        School Kit
      </div>
      <NavList pathname={pathname} />
    </aside>
  );
}
