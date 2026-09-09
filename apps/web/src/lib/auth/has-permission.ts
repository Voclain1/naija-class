/**
 * Does this permission list admit `perm`?
 *
 * `"*"` is the owner wildcard — an owner's grant is literally the single
 * string `["*"]` (verifiable at /auth/me), so every check must honour it
 * rather than looking for the specific permission.
 *
 * Extracted here on 2026-09-09 following the instruction the second copy left
 * behind: (admin)/finance/dashboard/page.tsx carried a local duplicate of
 * sidebar.tsx's private helper with the note "Kept local rather than lifted to
 * a shared module because that would be a cross-cutting refactor riding along
 * on a bursar bugfix; if a third caller appears, extract it then." The
 * dashboard header's quick actions are that third caller.
 */
export function hasPermission(permissions: string[], perm: string): boolean {
  return permissions.includes("*") || permissions.includes(perm);
}
