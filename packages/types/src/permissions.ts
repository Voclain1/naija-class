// Permission strings. Canonical source — referenced by:
//   - apps/api guards (`@Permissions(...)`)
//   - packages/db seed (system role permission lists)
//
// Phases extend this list as new resources land. The `*` wildcard is a magic
// value used by the `owner` role to mean "every permission."

export const PHASE_0_PERMISSIONS = [
  "school.read",
  "school.update",
  "branch.read",
  "branch.create",
  "branch.update",
  "branch.delete",
  "user.read",
  "user.invite",
  "user.update",
  "user.deactivate",
  "role.read",
  "role.update",
  "audit.read",
] as const;

export const ALL_PERMISSIONS = [...PHASE_0_PERMISSIONS] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number] | "*";

export const PERMISSION_WILDCARD: Permission = "*";
