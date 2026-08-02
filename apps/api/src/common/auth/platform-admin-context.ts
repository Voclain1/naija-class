// Shape of req.platformAdmin once PlatformAdminGuard has resolved the
// bearer token AND confirmed users.is_platform_admin. Mirrors AuthContext
// (auth-context.ts) / GuardianAuthContext (guardian-auth-context.ts) —
// kept as its own separate type (not a union with either) so a handler can
// never accidentally accept a staff or guardian context where a platform-
// admin one is required, or vice versa.
//
// Deliberately no schoolId — a platform-admin session is cross-tenant by
// definition (see platform_admin_resolve_session's header comment).
export interface PlatformAdminContext {
  sessionId: string;
  userId: string;
}
