import {
  BarChart3,
  BookOpenCheck,
  Bus,
  BedDouble,
  DoorOpen,
  Inbox,
  Library,
  Megaphone,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Contact,
  FileBarChart,
  FileQuestion,
  FileSearch,
  FileText,
  GraduationCap,
  HeartPulse,
  Stethoscope,
  LayoutDashboard,
  NotebookText,
  ScrollText,
  ShieldAlert,
  MonitorCheck,
  Newspaper,
  Settings,
  Sparkles,
  SlidersHorizontal,
  UserCircle,
  UserPlus,
  Users,
  Wallet,
  type LucideIcon,
  MessagesSquare,
} from "lucide-react";

import type { NavGroupKey } from "./nav-groups";

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
  // The family this page belongs to in the menu (nav-groups.ts). Omitted ->
  // the item stands on its own (Dashboard, Profile).
  group?: NavGroupKey;
  // Everyday words a member of staff might type in the menu's search box to
  // find this page ("fees" finds Finance, "parents" finds Guardians).
  keywords?: string[];
  // Hidden from anyone who holds this permission: for a page that a stronger
  // one already covers (School news is the reading view of Announcements, so
  // whoever sends announcements sees the sending desk instead).
  hiddenWithPermission?: string;
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
  { label: "Students", href: "/students", icon: GraduationCap, group: "people", keywords: ["pupils", "children", "learners"], enabled: true, requiredPermission: "student.read" },
  // Added 2026-09-16. The guardian roster — the parent-facing product's front
  // door, which did not exist: parents were reachable only one student at a
  // time. Gated on guardian.read, which owner and admin hold.
  { label: "Guardians", href: "/guardians", icon: Contact, group: "people", keywords: ["parents", "families"], enabled: true, requiredPermission: "guardian.read" },
  { label: "Staff", href: "/staff", icon: Users, group: "people", keywords: ["teachers", "employees", "salary", "invite"], enabled: true, requiredPermission: "user.read" },
  { label: "Enrollments", href: "/enrollments", icon: UserPlus, group: "people", keywords: ["classes", "promote", "term"], enabled: true, requiredPermission: "enrollment.read" },
  // Phase 9 / CP7.1 — admission applications (docs/modules/phase-9.md §16.8).
  // admission.read: owner, admin and Admissions officers.
  { label: "Admissions", href: "/admissions", icon: Inbox, group: "people", keywords: ["applications", "apply", "new students"], enabled: true, requiredPermission: "admission.read" },
  // Phase 8 / CP3 (docs/modules/phase-8.md §17 D36). Promoted from "Coming soon".
  // Gated on timetable.read — owner/admin only in CP3; teacher, student and
  // guardian timetable views are CP4's.
  { label: "Timetable", href: "/timetable", icon: CalendarClock, group: "teaching", keywords: ["periods", "schedule"], enabled: true, requiredPermission: "timetable.read" },
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
  { label: "Lesson plans", href: "/teacher/lesson-plans", icon: NotebookText, group: "teaching", keywords: ["lesson notes", "scheme of work"], enabled: true, requiredPermission: "lesson-plan.read" },
  // 2026-10-19 (the role audit). Owner and admin hold curriculum.* but no
  // menu reached the curriculum library; cross-shell like Lesson plans,
  // which it feeds.
  { label: "Curriculum", href: "/teacher/curriculum", icon: Library, group: "teaching", keywords: ["syllabus", "scheme of work", "upload"], enabled: true, requiredPermission: "curriculum.read" },
  // Homework (docs/modules/the-school-day.md Part B), added 2026-10-14 by the
  // pre-build audit. A read-only lookup by class, so a bursar can answer "what
  // homework does my child have?" at the counter — the reason they hold
  // homework.read, which no screen used. Owner, admin and bursar hold it;
  // teachers do too but set homework from the teacher shell.
  { label: "Homework", href: "/homework", icon: BookOpenCheck, group: "teaching", keywords: ["assignments"], enabled: true, requiredPermission: "homework.read" },
  // Phase 8c / CP5b (docs/modules/phase-8.md §22.2). Links across shells into
  // the teacher shell, exactly as Lesson plans above does and for the same
  // reasons. Owner/admin see every subject there.
  { label: "Question bank", href: "/teacher/question-bank", icon: FileQuestion, group: "teaching", keywords: ["questions"], enabled: true, requiredPermission: "question.read" },
  // Added 2026-09-15. Owner/admin score entry for any class and subject. The
  // API has allowed it since Phase 2 / Slice 2 (admins unscoped), but the only
  // gradebook screen was the teacher's, so owners were inviting themselves as
  // teachers to enter marks. Gated on assessment-score.create: owner (wildcard)
  // and admin hold it; bursar does not; teachers hold it but use the teacher
  // shell's own Gradebook and never see this sidebar.
  { label: "Gradebook", href: "/gradebook", icon: ClipboardList, group: "results", keywords: ["scores", "marks", "CA"], enabled: true, requiredPermission: "assessment-score.create" },
  // Phase 8c / CP5c (§22.3). Promoted from "Coming soon" as "Assessments &
  // Exams": papers set from the bank, printed or exported. Cross-shell, as above.
  { label: "Exam papers", href: "/teacher/exam-papers", icon: ScrollText, group: "results", keywords: ["exams", "papers"], enabled: true, requiredPermission: "exam-paper.read" },
  // Online exams (CBT, docs/modules/cbt.md): a FINAL paper sat on the school's
  // lab computers. Cross-shell, as above.
  { label: "Online exams", href: "/teacher/cbt", icon: MonitorCheck, group: "results", keywords: ["CBT", "computer exams"], enabled: true, requiredPermission: "cbt.read" },
  { label: "Report Cards", href: "/report-cards", icon: FileText, group: "results", keywords: ["results", "terminal report"], enabled: true, requiredPermission: "report-card.read" },
  // Phase 8c / CP6b (docs/modules/phase-8.md §21). Promoted from "Coming soon"
  // on 2026-10-05: the feature shipped in #365/#366, but this entry kept saying
  // "Coming soon" for a feature schools already had. It lands on the PIN cards
  // page — the school's side of the checker; the checker itself is the public
  // portal page families use. Gated on result-pin.read: owner/admin only.
  { label: "Result Checker", href: "/report-cards/pins", icon: FileSearch, group: "results", keywords: ["PIN", "scratch card", "check result"], enabled: true, requiredPermission: "result-pin.read" },
  // Phase 9 / CP2.2 (docs/modules/phase-9.md §9 CP2-D2) — incidents involving
  // more than one student. Gated on behaviour.read, which owner and admin hold
  // here and bursar never does (C14). Teachers reach it in their own shell.
  { label: "Behaviour", href: "/behaviour", icon: ShieldAlert, group: "care", keywords: ["discipline", "incidents"], enabled: true, requiredPermission: "behaviour.read" },
  // Phase 9 / CP3.1 — health records (docs/modules/phase-9.md §10). Owner, admin
  // and the Health officer, whose whole menu this is.
  { label: "Health", href: "/health", icon: HeartPulse, group: "care", keywords: ["medical", "allergies", "vaccinations"], enabled: true, requiredPermission: "health.read" },
  // Phase 9 / CP3.3 — the sickbay log. sickbay.manage: owner, admin and the
  // Health officer. A teacher never holds it.
  { label: "Sickbay", href: "/sickbay", icon: Stethoscope, group: "care", keywords: ["clinic", "nurse", "sick"], enabled: true, requiredPermission: "sickbay.manage" },
  // Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13). transport.read:
  // owner, admin and the bursar (who sets route fees there). Teachers never.
  { label: "Transport", href: "/transport", icon: Bus, group: "services", keywords: ["bus", "school bus", "routes"], enabled: true, requiredPermission: "transport.read" },
  // Phase 9 / CP6.1 — the library (docs/modules/phase-9.md §14). library.read:
  // owner, admin and the Librarian, whose whole menu this is.
  { label: "Library", href: "/library", icon: Library, group: "services", keywords: ["books", "borrow"], enabled: true, requiredPermission: "library.read" },
  // Phase 9 / CP6b.1 — hostels (docs/modules/phase-9.md §15). hostel.read:
  // owner, admin and the bursar (who sets hostel fees there).
  { label: "Hostels", href: "/hostels", icon: BedDouble, group: "services", keywords: ["boarding house", "beds", "rooms"], enabled: true, requiredPermission: "hostel.read" },
  // Phase 9 / CP6b.2 — a hostel's boarders and visitor log. hostel.house:
  // admin and the House master, whose whole menu this is. (A teacher who keeps
  // a hostel reaches it from the teacher portal.)
  { label: "Boarding", href: "/boarding", icon: DoorOpen, group: "services", keywords: ["boarders", "exeat", "leave-out", "visitors"], enabled: true, requiredPermission: "hostel.house" },
  { label: "Finance", href: "/finance/dashboard", icon: Wallet, group: "money", keywords: ["fees", "invoices", "payments", "debtors", "expenses", "payroll", "salary"], enabled: true, requiredPermission: "finance.dashboard.read" },
  // Phase 9 / CP8.1 — private messages from parents (docs/modules/phase-9.md
  // §17.8). messages.read: admin and bursar here (teachers, principals and
  // head teachers reach it from the teacher portal); the service shows each
  // only the conversations addressed or passed to them.
  { label: "Messages", href: "/messages", icon: MessagesSquare, group: "communication", keywords: ["inbox", "chat", "parents"], enabled: true, requiredPermission: "messages.read" },
  // Announcements (docs/modules/announcements.md). Gated on
  // announcement.create, not announcement.read: every staff role can READ the
  // school's announcements in their own feed, but this page is the sending
  // desk, and owner/admin are the only roles allowed to send (A1). Gating on
  // read would put it in a teacher's and a bursar's sidebar pointing at a
  // compose form the API refuses.
  { label: "Announcements", href: "/announcements", icon: Megaphone, group: "communication", keywords: ["news", "broadcast", "email parents"], enabled: true, requiredPermission: "announcement.create" },
  // 2026-10-19 (the role audit) — announcements for staff to read. Every
  // staff role holds announcement.read but only senders had a page; a bursar,
  // a health officer or a librarian could read the school's news only in the
  // phone app.
  { label: "School news", href: "/news", icon: Newspaper, group: "communication", keywords: ["announcements", "notices"], enabled: true, requiredPermission: "announcement.read", hiddenWithPermission: "announcement.create" },
  // Phase 8 / CP1 (docs/modules/phase-8.md §15). Promoted from "Coming soon".
  // Gated on calendar-event.read, which owner/admin/teacher/bursar all hold
  // (D4: visible to all users) — so bursar's filtered sidebar shows it too, and
  // the page itself hides management controls from anyone without the write
  // permissions.
  { label: "Event Calendar", href: "/events", icon: CalendarDays, group: "communication", keywords: ["calendar", "holidays", "PTA", "RSVP"], enabled: true, requiredPermission: "calendar-event.read" },
  // Phase 8 / CP2 (docs/modules/phase-8.md §16). Promoted from "Coming soon".
  // v1 is a recording-completeness report, not outcome analytics (§16.1).
  // Gated on reports.completeness.read — owner/admin only, so teacher and
  // bursar sidebars never show it.
  { label: "Reports", href: "/reports", icon: FileBarChart, group: "reports", keywords: ["attendance report", "completeness"], enabled: true, requiredPermission: "reports.completeness.read" },
  // Phase 5 / Slice 8. Gated on insight.read, which admin/owner hold and
  // bursar and teacher do not — these reports rank classes and subjects
  // against each other across the school, which is management information
  // about colleagues' work rather than teaching or finance workflow.
  { label: "Insights", href: "/insights", icon: Sparkles, group: "reports", keywords: ["analytics", "performance"], enabled: true, requiredPermission: "insight.read" },
  // Gated on a WRITE permission (not academic-year.read) on purpose: bursar
  // holds academic-year.read/term.read/class-arm.read too (added 2026-08-02,
  // see PHASE_3_BURSAR_PERMISSIONS) but only as read-only scoping context for
  // finance pages, not access to the academic-structure management screens
  // this nav item links to (years/terms/class-levels/arms/subjects/matrix
  // CRUD). Gating on a create permission keeps bursar's filtered sidebar
  // showing just Finance, matching what they can actually do here.
  { label: "Academics", href: "/settings/academic", icon: BarChart3, group: "setup", keywords: ["sessions", "terms", "classes", "subjects", "arms"], enabled: true, requiredPermission: "academic-year.create" },
  { label: "Grading", href: "/settings/grading", icon: SlidersHorizontal, group: "setup", keywords: ["grades", "grading scheme"], enabled: true, requiredPermission: "grading-scheme.read" },
  { label: "Settings", href: "/settings", icon: Settings, group: "setup", keywords: ["profile", "logo", "SMS", "sign in"], enabled: true, requiredPermission: "school.read" },
  // 2026-10-19 (the role audit). Every member of staff has their own
  // profile (their BVN for payroll), but it was linked only from the Settings
  // page, which a bursar, health officer, librarian or house master cannot
  // open. No permission: it is about the person themselves.
  { label: "My profile", href: "/settings/profile", icon: UserCircle, keywords: ["BVN", "bank", "my account"], enabled: true },
];

export const LATER_PHASE_ITEMS: NavItem[] = [
  { label: "AI Tutor", href: "/ai-tutor", icon: Sparkles, enabled: false },
];
