import { hasPermission } from "../auth/permissions";
import { isTeacher } from "../auth/roles";
import type { AuthMeRoleDto } from "@school-kit/types";

// Which staff sections appear in the bottom bar, for WHICH person.
//
// CP8 fixed the bar at Home, Marks, Classes, Notes. That is right for a
// teacher and wrong for everyone else: Marks, Classes and Notes all read
// `/teacher-scope/*`, which the server refuses for anyone without the teacher
// role (CP4 D32). An owner tapping "Classes" would land on a screen that can
// only fail.
//
// So the bar is computed from the person, and kept PURE so it is tested
// without rendering anything. Home is always there. The rule the CP8 spec
// holds — the bar carries daily destinations only, at most five — still
// applies to every combination.

export type StaffTabName = "index" | "gradebook" | "classes" | "lesson-notes" | "approvals";

/** Every staff route that CAN be a tab. Anything else is always hidden. */
export const TAB_CANDIDATES: readonly StaffTabName[] = [
  "index",
  "gradebook",
  "classes",
  "lesson-notes",
  "approvals",
];

export function visibleStaffTabs(
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined,
  permissions: readonly string[] = [],
): Set<StaffTabName> {
  const visible = new Set<StaffTabName>(["index"]);
  if (isTeacher(roles)) {
    visible.add("gradebook");
    visible.add("classes");
    visible.add("lesson-notes");
  }
  // CP4b — report card approval is a head's daily job at term end, so it
  // earns a tab for whoever can do it. On permission, like every other gate
  // that is not /teacher-scope/*.
  if (hasPermission(permissions, "report-card.principal-approve")) {
    visible.add("approvals");
  }
  return visible;
}
