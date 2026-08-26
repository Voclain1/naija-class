// Permission check for the staff surface.
//
// Deliberately the SAME shape as apps/web's inline copies (sidebar.tsx,
// finance/dashboard/page.tsx, bvn-section.tsx, guardians-tab.tsx): the owner
// role holds the literal "*" and everything else holds explicit strings.
//
// This is a DISPLAY decision only — what to offer, not what to allow. Every
// endpoint behind these screens is guarded server-side by PermissionsGuard,
// and the phone re-implements none of that. The point of checking here is to
// avoid routing a bursar to a screen that can only 403 at them, which is the
// same reasoning the CP2 arm list used for form-teacher arms.
export function hasPermission(permissions: readonly string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}
