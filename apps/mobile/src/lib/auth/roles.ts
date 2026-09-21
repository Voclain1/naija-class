import type { AuthMeRoleDto } from "@school-kit/types";

// CP4 D32 — the one place the staff app asks about a ROLE rather than a
// permission, and why that is the rule applied rather than broken.
//
// Every tile and screen is offered on PERMISSION, so the phone never offers
// what the server would refuse. But `/teacher-scope/*` is gated server-side on
// the teacher ROLE (`assertUserActiveAndHasOneOf(["teacher"])` in
// TeacherScopeService), deliberately, and holding `*` does not get an owner
// past it. Asking "is this person a teacher?" by role is therefore the only
// way to ask "would the server accept this call?" — which is the question the
// permission rule exists to answer.
//
// Use this for teacher-scope surfaces ONLY. Anywhere the server gates on a
// permission, gate on that permission.

export function hasRole(roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined, key: string): boolean {
  return (roles ?? []).some((role) => role.key === key);
}

/** Whether the server will answer `/teacher-scope/*` for this person. */
export function isTeacher(roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined): boolean {
  return hasRole(roles, "teacher");
}

/**
 * Whether the server will answer the ADMIN student endpoints (`/students`,
 * `/students/:id`, create, update, withdraw, graduate) for this person.
 *
 * Same reasoning as isTeacher: StudentsService gates on the owner/admin ROLE
 * (`assertUserActiveAndHasOneOf(["owner", "admin"])`), and a teacher also
 * holds `student.read` — for their own class lists — so gating the Students
 * screen on that permission would offer every teacher a screen that can only
 * refuse them.
 */
export function isSchoolAdmin(roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined): boolean {
  return hasRole(roles, "owner") || hasRole(roles, "admin");
}
