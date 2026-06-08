"use client";

import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  LayoutDashboard,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// The teacher portal's MINIMAL nav. Deliberately NOT the admin sidebar: a
// teacher sees only their own surfaces (no Students / Staff / Academics /
// Settings IA). Dashboard / Classes / Profile shipped in slice 11 cp3;
// Gradebook added in Phase 2 / Slice 3.
// Attendance (Phase 2 / Slice 7) links to the daily register (the default); the
// term summary is a sub-link inside the page. The entry shows for everyone in
// the portal — a subject-only teacher who opens it sees the empty-picker "form
// teachers only" message (the server is the real gate).
const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/teacher/dashboard", icon: LayoutDashboard },
  { label: "Classes", href: "/teacher/classes", icon: BookOpen },
  { label: "Gradebook", href: "/teacher/gradebook", icon: ClipboardList },
  { label: "Attendance", href: "/teacher/attendance", icon: CalendarCheck },
  { label: "Profile", href: "/teacher/profile", icon: UserCircle },
];

export function TeacherSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4 font-semibold">
        School Kit
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
