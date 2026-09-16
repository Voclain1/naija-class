import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Contact,
  FileBarChart,
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
// four items added 2026-07-31 (Arinzechukwu's request) — Timetable
// generator, Event calendar, Assessments & exams, Result checker — all
// still-unbuilt features tracked in docs/deferred.md's "Future feature
// ideas" section. (Lesson notes was a fifth until 2026-09-08, when it was
// promoted to a live NAV_ITEM: the feature had in fact shipped in the
// teacher shell as /teacher/lesson-plans and only the nav entry was stale.) Same treatment: greyed out, non-clickable (NavList's
// `!item.enabled` branch renders a non-link span with `title="Coming soon"`),
// no functionality behind them yet.
//
// Event calendar left this list on 2026-09-13, promoted to NAV_ITEMS when
// Phase 8 / CP1 shipped it (docs/modules/phase-8.md §15). Reports followed with
// Phase 8 / CP2 (§16). Timetable followed with Phase 8 / CP3 (§17).
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, enabled: true, requiredPermission: "dashboard.read" },
  { label: "Students", href: "/students", icon: GraduationCap, enabled: true, requiredPermission: "student.read" },
  // Added 2026-09-16. The guardian roster — the parent-facing product's front
  // door, which did not exist: parents were reachable only one student at a
  // time. Gated on guardian.read, which owner and admin hold.
  { label: "Guardians", href: "/guardians", icon: Contact, enabled: true, requiredPermission: "guardian.read" },
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
  // Added 2026-09-15. Owner/admin score entry for any class and subject. The
  // API has allowed it since Phase 2 / Slice 2 (admins unscoped), but the only
  // gradebook screen was the teacher's, so owners were inviting themselves as
  // teachers to enter marks. Gated on assessment-score.create: owner (wildcard)
  // and admin hold it; bursar does not; teachers hold it but use the teacher
  // shell's own Gradebook and never see this sidebar.
  { label: "Gradebook", href: "/gradebook", icon: ClipboardList, enabled: true, requiredPermission: "assessment-score.create" },
  { label: "Report Cards", href: "/report-cards", icon: FileText, enabled: true, requiredPermission: "report-card.read" },
  // Lesson plans (Phase 5 / slice 2, shipped). The admin sidebar previously
  // listed this under "Coming soon" pointing at /lesson-notes — a route that
  // NEVER EXISTED. The feature shipped in the TEACHER shell as
  // /teacher/lesson-plans, under a different name, so the admin sidebar was
  // advertising a page nobody built for a feature that was already live.
  //
  // This deliberately links ACROSS SHELLS, which is a real wart: clicking it
  // swaps the admin chrome for the teacher chrome. It is accepted over the
  // alternatives because (a) building a separate admin lesson-plans view is
  // days of work outside a nav fix, and (b) silently dropping the item would
  // hide a shipped feature owner/admin genuinely hold permissions for.
  // (teacher)/layout.tsx has NO role gate — a bare RequireAuth — so an
  // admin can open it; that is what makes this viable at all.
  { label: "Lesson plans", href: "/teacher/lesson-plans", icon: NotebookText, enabled: true, requiredPermission: "lesson-plan.read" },
  // Phase 5 / Slice 8. Gated on insight.read, which admin/owner hold and
  // bursar and teacher do not — these reports rank classes and subjects
  // against each other across the school, which is management information
  // about colleagues' work rather than teaching or finance workflow.
  { label: "Insights", href: "/insights", icon: Sparkles, enabled: true, requiredPermission: "insight.read" },
  { label: "Finance", href: "/finance/dashboard", icon: Wallet, enabled: true, requiredPermission: "finance.dashboard.read" },
  // Phase 8 / CP1 (docs/modules/phase-8.md §15). Promoted from "Coming soon".
  // Gated on calendar-event.read, which owner/admin/teacher/bursar all hold
  // (D4: visible to all users) — so bursar's filtered sidebar shows it too, and
  // the page itself hides management controls from anyone without the write
  // permissions.
  { label: "Event Calendar", href: "/events", icon: CalendarDays, enabled: true, requiredPermission: "calendar-event.read" },
  // Phase 8 / CP2 (docs/modules/phase-8.md §16). Promoted from "Coming soon".
  // v1 is a recording-completeness report, not outcome analytics (§16.1).
  // Gated on reports.completeness.read — owner/admin only, so teacher and
  // bursar sidebars never show it.
  { label: "Reports", href: "/reports", icon: FileBarChart, enabled: true, requiredPermission: "reports.completeness.read" },
  // Phase 8 / CP3 (docs/modules/phase-8.md §17 D36). Promoted from "Coming soon".
  // Gated on timetable.read — owner/admin only in CP3; teacher, student and
  // guardian timetable views are CP4's.
  { label: "Timetable", href: "/timetable", icon: CalendarClock, enabled: true, requiredPermission: "timetable.read" },
  { label: "Settings", href: "/settings", icon: Settings, enabled: true, requiredPermission: "school.read" },
];

export const LATER_PHASE_ITEMS: NavItem[] = [
  { label: "AI Tutor", href: "/ai-tutor", icon: Sparkles, enabled: false },
  { label: "Assessments & Exams", href: "/exams", icon: ClipboardList, enabled: false },
  { label: "Result Checker", href: "/result-checker", icon: FileSearch, enabled: false },
];
