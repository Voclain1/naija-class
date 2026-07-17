// Shape of req.guardian once GuardianAuthGuard has resolved the portal
// session cookie's bearer token. Mirrors AuthContext (auth-context.ts)
// exactly, for guardians instead of staff — kept as a separate type (not a
// shared union) so a handler can never accidentally accept a staff
// AuthContext where a guardian one is required, or vice versa.
export interface GuardianAuthContext {
  sessionId: string;
  guardianId: string;
  schoolId: string;
}
