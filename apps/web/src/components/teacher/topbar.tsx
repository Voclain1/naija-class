"use client";

import { AdminTopbar } from "@/components/admin/topbar";

import { useTeacherNavItems } from "./sidebar";

// Wraps the shared AdminTopbar with the teacher portal's own nav items, so
// the mobile hamburger drawer (AdminTopbar -> MobileNav -> NavList) renders
// Dashboard/Classes/Gradebook/Attendance/Profile instead of admin's Students/
// Staff/Finance/Settings. TeacherLayout previously rendered the plain
// AdminTopbar with no items, which silently fell back to MobileNav's admin
// default — see docs/deferred.md "Teacher portal mobile nav shows admin
// items" and sidebar.tsx's useTeacherNavItems() header comment.
export function TeacherTopbar() {
  const items = useTeacherNavItems();
  return <AdminTopbar navItems={items} navLaterPhaseItems={[]} />;
}
