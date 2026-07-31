import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  FileSearch,
  FileText,
  GraduationCap,
  LayoutDashboard,
  NotebookText,
  Settings,
  Sparkles,
  SlidersHorizontal,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
}

// Shared between the sidebar and the ⌘K command dialog — one source of truth
// for "what pages exist and are they live yet."
//
// The mockup's "LATER PHASES" section lists Attendance/Report cards/Staff &
// payroll/Communication/AI tutor as an illustrative example, but those first
// four are real, shipped features in THIS codebase (Phase 2-4) — greying them
// out here would be a functional regression dressed up as a restyle, not a
// visual change. Only what's genuinely unbuilt goes in LATER_PHASE_ITEMS:
// Reports (pre-existing disabled item), AI Tutor (Phase 5, not started), and
// five items added 2026-07-31 (Arinzechukwu's request) — Lesson notes,
// Timetable generator, Event calendar, Assessments & exams, Result checker —
// all still-unbuilt features tracked in docs/deferred.md's "Future feature
// ideas" section. Same treatment: greyed out, non-clickable (NavList's
// `!item.enabled` branch renders a non-link span with `title="Coming soon"`),
// no functionality behind them yet.
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Students", href: "/students", icon: GraduationCap, enabled: true },
  { label: "Enrollments", href: "/enrollments", icon: UserPlus, enabled: true },
  { label: "Staff", href: "/staff", icon: Users, enabled: true },
  { label: "Academics", href: "/settings/academic", icon: BarChart3, enabled: true },
  { label: "Grading", href: "/settings/grading", icon: SlidersHorizontal, enabled: true },
  { label: "Report Cards", href: "/report-cards", icon: FileText, enabled: true },
  { label: "Finance", href: "/finance/dashboard", icon: Wallet, enabled: true },
  { label: "Settings", href: "/settings", icon: Settings, enabled: true },
];

export const LATER_PHASE_ITEMS: NavItem[] = [
  { label: "Reports", href: "/reports", icon: BarChart3, enabled: false },
  { label: "AI Tutor", href: "/ai-tutor", icon: Sparkles, enabled: false },
  { label: "Lesson Notes", href: "/lesson-notes", icon: NotebookText, enabled: false },
  { label: "Timetable", href: "/timetable", icon: CalendarClock, enabled: false },
  { label: "Event Calendar", href: "/events", icon: CalendarDays, enabled: false },
  { label: "Assessments & Exams", href: "/exams", icon: ClipboardList, enabled: false },
  { label: "Result Checker", href: "/result-checker", icon: FileSearch, enabled: false },
];
