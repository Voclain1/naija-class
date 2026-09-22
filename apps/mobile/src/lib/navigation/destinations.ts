import type { IconName } from "../../components/layout";
import { hasPermission } from "../auth/permissions";
import { isSchoolAdmin, isTeacher } from "../auth/roles";
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
  if (admin) {
    out.push({ key: "students", label: "Students", hint: "Find, add, update", icon: "people-circle-outline", group: "School", route: "/staff/students" });
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
  // CP9b — both permissions: the form lists categories before it can save.
  if (can("expense.create") && can("expense-category.read")) {
    out.push({ key: "expense", label: "Log an expense", hint: "With a receipt photo", icon: "receipt-outline", group: "Money", route: "/staff/expenses" });
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
    { key: "calendar", label: "School calendar", icon: "today-outline", group: "Calendar", route: "/calendar" },
  ];
}

export function studentDestinations(): Destination[] {
  return [
    { key: "home", label: "Home", icon: "home-outline", group: "Your school work", route: "/me" },
    { key: "results", label: "My results", icon: "ribbon-outline", group: "Your school work", route: "/me/results" },
    { key: "attendance", label: "My attendance", icon: "checkbox-outline", group: "Your school work", route: "/me/attendance" },
    { key: "fees", label: "My fees", icon: "cash-outline", group: "Your school work", route: "/me/fees" },
    { key: "timetable", label: "My timetable", icon: "calendar-outline", group: "Calendar", route: "/me/timetable" },
    { key: "calendar", label: "School calendar", icon: "today-outline", group: "Calendar", route: "/me/calendar" },
  ];
}

const GROUP_ORDER: MenuGroup[] = ["Your child", "Your school work", "Teaching", "School", "Money", "Calendar", "Account"];

/** Group for the menu, in a fixed order, dropping empty groups. */
export function groupDestinations(items: readonly Destination[]): { group: MenuGroup; items: Destination[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter(
    (section) => section.items.length > 0,
  );
}
