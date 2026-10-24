import type { IconName } from "../../components/layout";
import { hasPermission } from "../auth/permissions";
import { hasRole, isSchoolAdmin, isTeacher } from "../auth/roles";
import type { AuthMeRoleDto } from "@school-kit/types";

// Everywhere a person can go, in ONE place, per role.
//
// Both the dashboard's shortcut grid and the app menu read this list. Before
// it, the grid carried its own inline array of tiles with its own gates, and a
// menu written separately would have been a second copy — the kind that drifts
// until the menu offers a screen the grid does not, or offers one the server
// refuses. One function, two renderers, and the tests pin who sees what.
//
// Every gate here is the SAME gate the destination's server uses: permissions
// where the server checks permissions, and the teacher / owner-admin ROLE
// where the service checks a role (see src/lib/auth/roles.ts, CP4 D32).

export type MenuGroup = "Teaching" | "School" | "Money" | "Calendar" | "Your child" | "Your school work" | "Account";

export interface Destination {
  key: string;
  label: string;
  hint?: string;
  icon: IconName;
  group: MenuGroup;
  /** An in-app route. */
  route?: string;
  /** A website path, opened in the browser (CP4 D36). */
  web?: string;
}

export interface StaffContext {
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined;
  permissions: readonly string[];
  /** Classes this person form-teaches (from teacher scope). */
  formArms: readonly { id: string; name: string }[];
  /** Whether teacher scope lists at least one subject for them. */
  teachesSubjects: boolean;
  /** Whether teacher scope says they are house master of a hostel (CP6b.2). */
  housesHostels: boolean;
  /** Whether this build knows the website's address. */
  webConfigured: boolean;
}

export function staffDestinations(ctx: StaffContext): Destination[] {
  const teacher = isTeacher(ctx.roles);
  const admin = isSchoolAdmin(ctx.roles);
  const can = (permission: string) => hasPermission(ctx.permissions, permission);
  const out: Destination[] = [];

  // --- Teaching (teacher ROLE: every one of these reads /teacher-scope/*) ---
  if (teacher && can("assessment-score.create") && ctx.teachesSubjects) {
    out.push({ key: "marks", label: "Enter marks", hint: "Tests and exams", icon: "create-outline", group: "Teaching", route: "/staff/gradebook" });
  }
  if (teacher) {
    for (const arm of ctx.formArms) {
      out.push({
        key: `attendance-${arm.id}`,
        label: ctx.formArms.length > 1 ? `Attendance · ${arm.name}` : "Attendance",
        hint: arm.name,
        icon: "checkbox-outline",
        group: "Teaching",
        route: `/staff/attendance/${arm.id}`,
      });
    }
  }
  if (teacher && can("lesson-plan.create")) {
    out.push({ key: "lesson-notes", label: "Lesson notes", hint: "Write with AI", icon: "document-text-outline", group: "Teaching", route: "/staff/lesson-notes" });
    out.push({ key: "curriculum", label: "Curriculum", hint: "Scheme of work", icon: "library-outline", group: "Teaching", route: "/staff/curriculum" });
  }
  if (teacher) {
    for (const arm of ctx.formArms) {
      out.push({
        key: `comments-${arm.id}`,
        label: ctx.formArms.length > 1 ? `Report comments · ${arm.name}` : "Report comments",
        hint: arm.name,
        icon: "chatbox-ellipses-outline",
        group: "Teaching",
        route: `/staff/report-cards/${arm.id}`,
      });
    }
    out.push({ key: "classes", label: "My classes", icon: "people-outline", group: "Teaching", route: "/staff/classes" });
  }

  // --- School (owner/admin ROLE and the endpoint's permission) ---
  if (admin && can("report-card.principal-approve")) {
    out.push({ key: "approvals", label: "Report cards", hint: "Approve and release", icon: "ribbon-outline", group: "School", route: "/staff/approvals" });
  }
  // Result PIN cards (phase-8.md §21.3), the website's /report-cards/pins.
  // Owner/admin: the service re-checks the role behind result-pin.read.
  if (admin && can("result-pin.read")) {
    out.push({ key: "result-pins", label: "Result PINs", hint: "Cards for checking results", icon: "key-outline", group: "School", route: "/staff/report-cards/pins" });
  }
  if (admin) {
    out.push({ key: "students", label: "Students", hint: "Find, add, update", icon: "people-circle-outline", group: "School", route: "/staff/students" });
  }
  // Phase 9 / CP2.3 — proposed discipline actions to approve or reject. The
  // service checks the owner/admin role behind behaviour.decide.
  // Phase 9 / CP11.2 — incidents, read-only. The service shows a teacher
  // their own classes and an owner or admin everything.
  if (can("behaviour.read")) {
    out.push({ key: "incidents", label: "Incidents", hint: "Behaviour incidents recorded", icon: "alert-circle-outline", group: teacher ? "Teaching" : "School", route: "/staff/behaviour" });
  }
  if (admin && can("behaviour.decide")) {
    out.push({ key: "discipline", label: "Behaviour decisions", hint: "Approve or reject", icon: "shield-checkmark-outline", group: "School", route: "/staff/discipline" });
  }
  // Phase 9 / CP3.1 — health records. The service checks the owner, admin or
  // health_officer ROLE behind health.read; the Health officer's main screen.
  if ((admin || hasRole(ctx.roles, "health_officer")) && can("health.read")) {
    out.push({ key: "health", label: "Health", hint: "Health records", icon: "medkit-outline", group: "School", route: "/staff/health" });
  }
  // Phase 9 / CP5.3 — the bus routes and each one's day. transport.read is a
  // permission check on the server: owner, admin and the bursar.
  if (can("transport.read")) {
    out.push({ key: "transport", label: "Bus routes", hint: "Today's pickups", icon: "bus-outline", group: "School", route: "/staff/transport" });
  }
  // Phase 9 / CP6.2 — the library's loans and lending desk. library.read is a
  // permission check on the server: owner, admin and the Librarian, whose
  // main screen this is.
  if (can("library.read")) {
    out.push({ key: "library", label: "Library", hint: "Lend and take back", icon: "library-outline", group: "School", route: "/staff/library" });
  }
  // The school store's stock (docs/modules/id-cards-and-store.md §4).
  // store.read is a permission check on the server: owner, admin, the
  // Storekeeper (whose main screen this is) and the bursar.
  if (can("store.read")) {
    out.push({ key: "store", label: "Store", hint: "Stock on hand", icon: "cube-outline", group: "School", route: "/staff/store" });
  }
  // Phase 9 / CP6b.2 — a hostel's boarders and visitor log. hostel.house is a
  // permission check on the server; the service then keeps a teacher to the
  // hostels they are house master of, so a teacher without one is not shown it.
  if (can("hostel.house") && (admin || hasRole(ctx.roles, "house_master") || (teacher && ctx.housesHostels))) {
    out.push({ key: "boarding", label: "Boarding", hint: "Boarders and visitors", icon: "bed-outline", group: "School", route: "/staff/boarding" });
  }
  // Phase 9 / CP8.1 — parents' messages. messages.read is the server's own
  // check; the service then shows each person only what is addressed or
  // passed to them (docs/modules/phase-9.md §17.8).
  if (can("messages.read")) {
    out.push({ key: "messages", label: "Messages", hint: "From parents", icon: "chatbubbles-outline", group: "School", route: "/staff/messages" });
  }
  if (admin && can("reports.completeness.read")) {
    out.push({ key: "reports", label: "Reports", hint: "What's behind", icon: "bar-chart-outline", group: "School", route: "/staff/reports" });
  }

  // --- Money (permission-gated: the finance endpoints check permissions) ---
  if (can("finance.dashboard.read")) {
    out.push({ key: "collections", label: "Collections", hint: "Fees collected", icon: "cash-outline", group: "Money", route: "/staff/collections" });
  }
  if (can("finance.debtors.read")) {
    out.push({ key: "debtors", label: "Who owes", hint: "Outstanding fees", icon: "alert-circle-outline", group: "Money", route: "/staff/collections/debtors" });
  }
  // Branded receipts — the server also checks the owner/admin/bursar ROLE.
  if ((admin || hasRole(ctx.roles, "bursar")) && can("payment.read")) {
    out.push({ key: "receipts", label: "Receipts", hint: "Share or print", icon: "document-text-outline", group: "Money", route: "/staff/receipts" });
  }
  // CP9b — both permissions: the form lists categories before it can save.
  if (can("expense.create") && can("expense-category.read")) {
    out.push({ key: "expense", label: "Log an expense", hint: "With a receipt photo", icon: "receipt-outline", group: "Money", route: "/staff/expenses" });
  }

  // Announcements. Gated on announcement.read, which EVERY staff role holds —
  // a teacher and a bursar read the school's messages on the same screen an
  // owner sends them from; the compose form inside it checks the owner/admin
  // role the service checks. Sitting in "School" rather than "Account"
  // because it is the school talking, not a personal setting.
  if (can("announcement.read")) {
    out.push({ key: "announcements", label: "Announcements", hint: "From the school", icon: "megaphone-outline", group: "School", route: "/staff/announcements" });
  }

  // The school's public website: news and photos (docs/modules/school-website.md).
  // website.manage AND the owner or admin role, because the API checks both.
  if (admin && can("website.manage")) {
    out.push({ key: "website-news", label: "School website", hint: "News and photos", icon: "newspaper-outline", group: "School", route: "/staff/website" });
  }

  // Homework (the-school-day.md B8). Gated on homework.create, not .read: this
  // screen's job is SETTING work, and a bursar holds read so they can answer a
  // parent at the counter — a compose form in their menu would be a form the
  // server refuses. Sits in Teaching for a teacher and School for an admin,
  // because for one it is their own classes and for the other it is oversight.
  if (can("homework.create")) {
    out.push({
      key: "homework",
      label: "Homework",
      hint: teacher ? "Set work for your classes" : "What the school has set",
      icon: "book-outline",
      group: teacher ? "Teaching" : "School",
      route: "/staff/homework",
    });
  }
  // The read-only lookup for someone who holds homework.read but cannot set
  // work — a bursar, answering a parent at the counter. Anyone who can set
  // homework already has the full screen above, which lists it too.
  else if (can("homework.read")) {
    out.push({
      key: "homework",
      label: "Homework",
      hint: "Look up a class's homework",
      icon: "book-outline",
      group: "School",
      route: "/staff/homework/lookup",
    });
  }

  // Question bank, exam papers and online exams (phase-8.md §22.2–22.3,
  // cbt.md), brought to the app by the owner's decision on the pre-build
  // audit (2026-10-14). Admin and teacher hold all three permissions; each
  // service holds a teacher to the subjects they teach, so the menu offers
  // them on the permission and the screens show what the server returns.
  if (can("question.read")) {
    out.push({ key: "question-bank", label: "Question bank", hint: "Questions, and AI drafts to check", icon: "help-circle-outline", group: teacher ? "Teaching" : "School", route: "/staff/question-bank" });
  }
  if (can("exam-paper.read")) {
    out.push({ key: "exam-papers", label: "Exam papers", hint: "Set, finalise and export", icon: "newspaper-outline", group: teacher ? "Teaching" : "School", route: "/staff/exam-papers" });
  }
  if (can("cbt.read")) {
    out.push({ key: "online-exams", label: "Online exams", hint: "Schedule and see results", icon: "desktop-outline", group: teacher ? "Teaching" : "School", route: "/staff/online-exams" });
  }

  // --- Calendar ---
  if (teacher) {
    out.push({ key: "timetable", label: "Timetable", icon: "calendar-outline", group: "Calendar", route: "/staff/timetable" });
  }
  if (can("calendar-event.read")) {
    out.push({ key: "calendar", label: "School calendar", icon: "today-outline", group: "Calendar", route: "/staff/calendar" });
  }

  // --- Account ---
  if (teacher) {
    out.push({ key: "profile", label: "My profile", icon: "person-outline", group: "Account", route: "/staff/profile" });
  }
  if (can("dashboard.read") && ctx.webConfigured) {
    out.push({ key: "website", label: "Open the website", hint: "Settings, staff, payroll", icon: "globe-outline", group: "Account", web: "/dashboard" });
  }
  return out;
}

export function guardianDestinations(): Destination[] {
  return [
    { key: "children", label: "My children", icon: "people-outline", group: "Your child", route: "/students" },
    { key: "announcements", label: "From the school", hint: "Announcements", icon: "megaphone-outline", group: "Your child", route: "/announcements" },
    // Phase 9 / CP8.1 — private conversations with a teacher or the school.
    { key: "messages", label: "Messages", hint: "Write to a teacher or the school", icon: "chatbubbles-outline", group: "Your child", route: "/messages" },
    { key: "calendar", label: "School calendar", icon: "today-outline", group: "Calendar", route: "/calendar" },
    // 2026-10-19 — what the school store sells and the price.
    { key: "store", label: "School store prices", hint: "Uniforms, books and more", icon: "pricetags-outline", group: "Your child", route: "/store-prices" },
    // Phase 9 / CP11.1 — the announcement-email switch, as on the portal.
    { key: "settings", label: "Settings", hint: "Emails from the school", icon: "settings-outline", group: "Account", route: "/settings" },
  ];
}

export function studentDestinations(): Destination[] {
  return [
    { key: "home", label: "Home", icon: "home-outline", group: "Your school work", route: "/me" },
    { key: "results", label: "My results", icon: "ribbon-outline", group: "Your school work", route: "/me/results" },
    { key: "attendance", label: "My attendance", icon: "checkbox-outline", group: "Your school work", route: "/me/attendance" },
    { key: "fees", label: "My fees", icon: "cash-outline", group: "Your school work", route: "/me/fees" },
    { key: "homework", label: "My homework", hint: "What is due", icon: "book-outline", group: "Your school work", route: "/me/homework" },
    { key: "announcements", label: "From the school", hint: "Announcements", icon: "megaphone-outline", group: "Your school work", route: "/me/announcements" },
    { key: "timetable", label: "My timetable", icon: "calendar-outline", group: "Calendar", route: "/me/timetable" },
    { key: "calendar", label: "School calendar", icon: "today-outline", group: "Calendar", route: "/me/calendar" },
    // Phase 7's tutor, honestly labelled until it exists (C2).
    { key: "tutor", label: "Ask about your work", hint: "Coming soon", icon: "sparkles-outline", group: "Your school work", route: "/me/tutor" },
  ];
}

const GROUP_ORDER: MenuGroup[] = ["Your child", "Your school work", "Teaching", "School", "Money", "Calendar", "Account"];

/** Group for the menu, in a fixed order, dropping empty groups. */
export function groupDestinations(items: readonly Destination[]): { group: MenuGroup; items: Destination[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (section) => section.items.length > 0,
  );
}
