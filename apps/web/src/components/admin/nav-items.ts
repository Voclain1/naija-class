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
  // Permission required to see this item. Omitted -> visible to anyone who
  // reaches the admin shell at all (today: owner/admin, both of which hold
  // every permission below anyway). Set on items a narrower role (bursar)
  // might reach the shell without holding — see useVisibleAdminNavItems()
  // in sidebar.tsx, which filters NAV_ITEMS against the signed-in user's
  // actual permissions rather than assuming shell access implies full access.
  requiredPermission?: string;
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
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true, requiredPermission: "dashboard.read" },
  { label: "Students", href: "/students", icon: GraduationCap, enabled: true, requiredPermission: "student.read" },
  { label: "Enrollments", href: "/enrollments", icon: UserPlus, enabled: true, requiredPermission: "enrollment.read" },
  { label: "Staff", href: "/staff", icon: Users, enabled: true, requiredPermission: "user.read" },
  // Gated on a WRITE permission (not academic-year.read) on purpose: bursar
  // holds academic-year.read/term.read/class-arm.read too (added 2026-08-02,
  // see PHASE_3_BURSAR_PERMISSIONS) but only as read-only scoping context for
  // finance pages, not access to the academic-structure management screens
  // this nav item links to (years/terms/class-levels/arms/subjects/matrix
  // CRUD). Gating on a create permission keeps bursar's filtered sidebar
  // showing just Finance, matching what they can actually do here.
  { label: "Academics", href: "/settings/academic", icon: BarChart3, enabled: true, requiredPermission: "academic-year.create" },
  { label: "Grading", href: "/settings/grading", icon: SlidersHorizontal, enabled: true, requiredPermission: "grading-scheme.read" },
  { label: "Report Cards", href: "/report-cards", icon: FileText, enabled: true, requiredPermission: "report-card.read" },
  { label: "Finance", href: "/finance/dashboard", icon: Wallet, enabled: true, requiredPermission: "finance.dashboard.read" },
  { label: "Settings", href: "/settings", icon: Settings, enabled: true, requiredPermission: "school.read" },
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
