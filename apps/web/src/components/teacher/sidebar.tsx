"use client";

import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Clock,
  BookCopy,
  DoorOpen,
  Inbox,
  Library,
  ShieldAlert,
  Sparkles,
  ClipboardList,
  FileQuestion,
  FileText,
  LayoutDashboard,
  ScrollText,
  MonitorCheck,
  Newspaper,
  UserCircle,
  MessagesSquare,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import type { NavItem } from "@/components/admin/nav-items";
import { NavList } from "@/components/admin/nav-list";
import { PoweredBySchoolKit, SchoolBrand } from "@/components/school/school-brand";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { getMyScope } from "@/lib/teacher/teacher-scope-api";

// The teacher portal's MINIMAL nav. Dashboard / Classes / Profile shipped in
// slice 11 cp3; Gradebook in Phase 2 / Slice 3; Attendance in Slice 7. The
// "Subject attendance" entry (Slice 8) is conditional — only rendered when the
// school has opted into subject-period attendance (School.subjectAttendanceEnabled).
//
// Reuses admin's NavItem shape (label/href/icon/enabled) so the same list can
// be handed to the shared NavList/MobileNav (components/admin/nav-list.tsx,
// mobile-nav.tsx) via components/teacher/topbar.tsx — every teacher item is
// `enabled: true` (no "coming soon" entries on this portal).
const BASE_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/teacher/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Classes", href: "/teacher/classes", icon: BookOpen, group: "my-classes", enabled: true },
  { label: "Attendance", href: "/teacher/attendance", icon: CalendarCheck, group: "my-classes", enabled: true },
  // Homework (docs/modules/the-school-day.md Part B). Directly under
  // Attendance: both are daily, both are about the class in front of you, and
  // this is the one a student's family sees the same day.
  { label: "Homework", href: "/teacher/homework", icon: BookMarked, group: "my-classes", enabled: true },
  // Phase 9 / CP2.2 — incidents involving more than one student. A single
  // child's record stays on their page in Classes.
  { label: "Behaviour", href: "/teacher/behaviour", icon: ShieldAlert, group: "my-classes", enabled: true },
  // Phase 5 / Slice 2 — lesson plan generator. Unconditional: unlike subject
  // attendance it needs no per-school opt-in, and unlike gradebook/report
  // cards it needs no prior data, so it is usable by every school from day one.
  { label: "Lesson plans", href: "/teacher/lesson-plans", icon: Sparkles, group: "lessons", enabled: true },
  // Phase 7 / CP2 — the curriculum library that grounds lesson plans. Sits
  // directly beneath "Lesson plans" because that is the only thing it feeds:
  // its whole purpose is to make the item above it produce better output, and
  // separating them would leave a teacher wondering what it is for.
  { label: "Curriculum", href: "/teacher/curriculum", icon: Library, group: "lessons", enabled: true },
  // Scores and results, first in the "Exams & results" family (nav-groups.ts).
  { label: "Gradebook", href: "/teacher/gradebook", icon: ClipboardList, group: "results", enabled: true },
  { label: "Report Cards", href: "/teacher/report-cards", icon: FileText, group: "results", enabled: true },
  // Phase 8c / CP5b (docs/modules/phase-8.md §22.2) — exam questions for the
  // subjects this teacher teaches. Grounded in the same curriculum as above.
  { label: "Question bank", href: "/teacher/question-bank", icon: FileQuestion, group: "results", enabled: true },
  // Phase 9 / CP6.3 — PDFs and links for the subjects the teacher teaches.
  { label: "Library resources", href: "/teacher/resources", icon: BookCopy, group: "lessons", enabled: true },
  // Phase 8c / CP5c (§22.3) — papers set from the approved questions above.
  { label: "Exam papers", href: "/teacher/exam-papers", icon: ScrollText, group: "results", enabled: true },
  // Online exams (CBT, docs/modules/cbt.md) — a final paper sat in the lab.
  { label: "Online exams", href: "/teacher/cbt", icon: MonitorCheck, group: "results", enabled: true },
  // Phase 8 / CP1 — read-only school calendar (docs/modules/phase-8.md §15).
  { label: "Calendar", href: "/teacher/calendar", icon: CalendarDays, group: "school", enabled: true },
  // Phase 8 / CP4 (docs/modules/phase-8.md §18 D37): own lessons + form-class grids.
  { label: "My timetable", href: "/teacher/timetable", icon: Clock, group: "my-classes", enabled: true },
];

const SUBJECT_ITEM: NavItem = {
  label: "Subject attendance",
  href: "/teacher/attendance/subject",
  icon: CalendarClock,
  group: "my-classes",
  enabled: true,
};

// Phase 9 / CP6b.2 — only for a teacher who is house master of a hostel.
const BOARDING_ITEM: NavItem = {
  label: "Boarding",
  href: "/teacher/boarding",
  icon: DoorOpen,
  group: "school",
  enabled: true,
};

// Phase 9 / CP7.1 — only for a teacher an admin has made an Admissions officer.
const ADMISSIONS_ITEM: NavItem = {
  label: "Admissions",
  href: "/teacher/admissions",
  icon: Inbox,
  group: "school",
  enabled: true,
};

// Phase 9 / CP8.1 — messages parents address to this teacher (as form or
// class teacher, principal or head teacher, or Inbox officer).
const MESSAGES_ITEM: NavItem = {
  label: "Messages",
  href: "/teacher/messages",
  icon: MessagesSquare,
  group: "school",
  enabled: true,
};

// For an owner or admin visiting the teacher shell: the pages the admin menu
// links into, and a way home.
const ADMIN_VISIBLE_HREFS = new Set([
  "/teacher/lesson-plans",
  "/teacher/curriculum",
  "/teacher/question-bank",
  "/teacher/exam-papers",
  "/teacher/cbt",
]);

const BACK_TO_ADMIN_ITEM: NavItem = {
  label: "Back to admin",
  href: "/dashboard",
  icon: ArrowLeft,
  enabled: true,
};

// 2026-10-19 — the school's announcements, to read (components/announcements/staff-news.tsx).
const NEWS_ITEM: NavItem = {
  label: "School news",
  href: "/teacher/news",
  icon: Newspaper,
  group: "school",
  enabled: true,
};

const PROFILE_ITEM: NavItem = {
  label: "Profile",
  href: "/teacher/profile",
  icon: UserCircle,
  enabled: true,
};

// Shared between TeacherSidebar (desktop rail, below) and TeacherTopbar
// (components/teacher/topbar.tsx, which hands the same list to the shared
// AdminTopbar/MobileNav for the mobile drawer) — one "what are my nav items"
// computation, two render targets. Previously this lived only inside
// TeacherSidebar, and TeacherLayout rendered the plain AdminTopbar with no
// items at all, which silently fell back to MobileNav's admin default — a
// teacher's mobile hamburger drawer showed admin's Students/Staff/Finance/
// Settings instead of their own nav (docs/deferred.md "Teacher portal mobile
// nav shows admin items", a regression from PR #120's MobileNav addition).
export function useTeacherNavItems(): NavItem[] {
  // The school's subject-attendance opt-in rides on /teacher-scope/me (the plan-
  // first decision) so teachers can read it without school-settings access.
  // Default hidden until it resolves / on error. /teacher-scope/me is gated to
  // the teacher role, so an owner/admin viewing the teacher portal gets a 403
  // here and the entry stays hidden — they reach the subject surface by URL.
  const [subjectEnabled, setSubjectEnabled] = useState(false);
  const [housesHostels, setHousesHostels] = useState(false);

  useEffect(() => {
    let active = true;
    getMyScope()
      .then((s) => {
        if (!active) return;
        setSubjectEnabled(s.subjectAttendanceEnabled);
        setHousesHostels(s.housesHostels);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const { permissions, roles } = useAuth();
  const admissions = hasPermission(permissions, "admission.read");
  const messages = hasPermission(permissions, "messages.read");

  // An owner or admin who is not also a teacher reaches this shell only
  // through the admin menu's cross-shell links (Lesson plans, Curriculum,
  // Question bank, Exam papers, Online exams). They used to get the whole
  // teacher menu, where Classes, Attendance and the rest refuse anyone without
  // a teaching timetable (the role audit, 2026-10-19). Now: those pages, and a
  // way back.
  const isTeacher = roles.some((r) => r.key === "teacher");
  const isAdmin = roles.some((r) => r.key === "owner" || r.key === "admin");
  if (isAdmin && !isTeacher) {
    return [BACK_TO_ADMIN_ITEM, ...BASE_ITEMS.filter((i) => ADMIN_VISIBLE_HREFS.has(i.href))];
  }
  return [
    ...BASE_ITEMS,
    ...(subjectEnabled ? [SUBJECT_ITEM] : []),
    ...(housesHostels ? [BOARDING_ITEM] : []),
    ...(admissions ? [ADMISSIONS_ITEM] : []),
    ...(messages ? [MESSAGES_ITEM] : []),
    ...(hasPermission(permissions, "announcement.read") ? [NEWS_ITEM] : []),
    PROFILE_ITEM,
  ];
}

export function TeacherSidebar() {
  const pathname = usePathname();
  const items = useTeacherNavItems();

  // The shared NavList (components/admin/nav-list.tsx), so the teacher menu
  // folds into the same families as the admin one and scrolls when long. Its
  // longest-match rule keeps daily and subject attendance from both lighting
  // up on /teacher/attendance/subject.
  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b border-border px-4">
        <SchoolBrand />
      </div>
      <NavList pathname={pathname} items={items} laterPhaseItems={[]} />
      <PoweredBySchoolKit />
    </aside>
  );
}
