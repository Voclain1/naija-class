// Shape of req.student once StudentAuthGuard has resolved the bearer token.
// Mirrors GuardianAuthContext, for students — kept as a separate type (not a
// shared union) so a handler can never accidentally accept a guardian context
// where a student one is required, or vice versa.
export interface StudentAuthContext {
  sessionId: string;
  studentId: string;
  schoolId: string;
}
