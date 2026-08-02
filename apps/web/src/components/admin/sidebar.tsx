"use client";

import { usePathname } from "next/navigation";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";
import { useAuth } from "@/lib/auth/use-auth";

import { LATER_PHASE_ITEMS, NAV_ITEMS, type NavItem } from "./nav-items";
import { NavList } from "./nav-list";

function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}

// The (admin) shell is no longer owner/admin-exclusive — bursar reaches it
// too (see (admin)/layout.tsx's RequireAuth roles), but bursar's permission
// set (PHASE_3_BURSAR_PERMISSIONS) is finance-only: no academic, roster,
// staff, or school-settings access. Rather than assume "reached the admin
// shell" implies "sees every admin nav item" (true only for owner/admin
// today), filter NAV_ITEMS against the signed-in user's actual permissions.
// Shared between AdminSidebar (desktop rail, below) and AdminTopbar (which
// hands the same list to MobileNav for the hamburger drawer) — one
// visibility computation, two render targets, mirroring the teacher
// portal's useTeacherNavItems() in components/teacher/sidebar.tsx.
export function useVisibleAdminNavItems(): { items: NavItem[]; laterPhaseItems: NavItem[] } {
  const { permissions, roles } = useAuth();
  const items = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || hasPermission(permissions, item.requiredPermission),
  );
  // "Coming soon" placeholders are only meaningful to owner/admin — bursar's
  // narrow finance scope has no bearing on any of them (Reports, AI Tutor,
  // Lesson Notes, Timetable, Events, Exams, Result Checker).
  const isOwnerOrAdmin = roles.some((r) => r.key === "owner" || r.key === "admin");
  return { items, laterPhaseItems: isOwnerOrAdmin ? LATER_PHASE_ITEMS : [] };
}

// Desktop-only persistent rail — hidden below md. Below md, mobile-nav.tsx's
// hamburger + drawer is the equivalent navigation surface (see topbar.tsx).
export function AdminSidebar() {
  const pathname = usePathname();
  const { items, laterPhaseItems } = useVisibleAdminNavItems();

  return (
    <aside className="hidden w-64 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-border px-5">
        <SchoolKitWordmark iconSize={26} textClassName="text-base" />
      </div>
      <NavList pathname={pathname} items={items} laterPhaseItems={laterPhaseItems} />
    </aside>
  );
}
