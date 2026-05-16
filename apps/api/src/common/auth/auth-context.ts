// Shape of req.user once AuthGuard has resolved the bearer token.
//
// Intentionally minimal: just the ids needed to scope a tenant query and
// audit who did what. Roles and permissions are NOT included — handlers
// that need them re-fetch via withTenant. See auth.guard.ts header for the
// "no stale permissions" rationale.
export interface AuthContext {
  sessionId: string;
  userId: string;
  schoolId: string;
}
