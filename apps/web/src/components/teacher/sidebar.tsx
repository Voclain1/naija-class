"use client";

import {
  BookOpen,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getMyScope } from "@/lib/teacher/teacher-scope-api";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

// The teacher portal's MINIMAL nav. Dashboard / Classes / Profile shipped in
// slice 11 cp3; Gradebook in Phase 2 / Slice 3; Attendance in Slice 7. The
// "Subject attendance" entry (Slice 8) is conditional — only rendered when the
// school has opted into subject-period attendance (School.subjectAttendanceEnabled).
const BASE_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/teacher/dashboard", icon: LayoutDashboard },
  { label: "Classes", href: "/teacher/classes", icon: BookOpen },
  { label: "Gradebook", href: "/teacher/gradebook", icon: ClipboardList },
  { label: "Attendance", href: "/teacher/attendance", icon: CalendarCheck },
];

const SUBJECT_ITEM: NavItem = {
  label: "Subject attendance",
  href: "/teacher/attendance/subject",
  icon: CalendarClock,
};

const PROFILE_ITEM: NavItem = { label: "Profile", href: "/teacher/profile", icon: UserCircle };

export function TeacherSidebar() {
  const pathname = usePathname();
  // The school's subject-attendance opt-in rides on /teacher-scope/me (the plan-
  // first decision) so teachers can read it without school-settings access.
  // Default hidden until it resolves / on error. /teacher-scope/me is gated to
  // the teacher role, so an owner/admin viewing the teacher portal gets a 403
  // here and the entry stays hidden — they reach the subject surface by URL.
  const [subjectEnabled, setSubjectEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    getMyScope()
      .then((s) => {
        if (active) setSubjectEnabled(s.subjectAttendanceEnabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const items: NavItem[] = [
    ...BASE_ITEMS,
    ...(subjectEnabled ? [SUBJECT_ITEM] : []),
    PROFILE_ITEM,
  ];

  // Disambiguate the daily vs subject attendance entries so both don't light up
  // on the /teacher/attendance/subject sub-tree.
  const onSubjectTree = pathname.startsWith("/teacher/attendance/subject");
  function isActive(href: string): boolean {
    if (href === "/teacher/attendance") {
      return (pathname === href || pathname.startsWith(`${href}/`)) && !onSubjectTree;
    }
    if (href === "/teacher/attendance/subject") return onSubjectTree;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4 font-semibold">
        School Kit
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
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
