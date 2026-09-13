// The guardian portal's base URL, in ONE place.
//
// Production must set PORTAL_BASE_URL explicitly (CLAUDE.md); dev falls back
// to apps/portal's dev port. The fallback is the reason this is centralised:
// it is a SILENT wrong answer, not a crash. A missing env var does not fail
// the boot — it quietly builds parent-facing URLs pointing at localhost, and
// CLAUDE.md records that exact bug shipping to production once already
// (PORTAL_BASE_URL added to the repo but never set on the Fly app, so
// invitation links pointed at localhost:3002 for real guardians).
//
// Every API caller that builds a portal URL uses this: the guardian
// invitation link (guardians.service.ts), the guardian password-reset link
// (portal-auth.service.ts), the Paystack checkout callback
// (portal-payments.service.ts), and SchoolMeDto.portalUrl (schools/auth
// services). Each once held its own copy of the fallback.
//
// Why shared rather than per-service copies: an earlier comment in
// portal-payments.service.ts argued the copies were "genuinely independent
// constants that happen to agree", by analogy with per-flow TTLs. That holds
// for a TTL — a policy each flow may legitimately change on its own — but not
// for the portal's address, which is ONE fact about the deployment. Copies can
// only ever diverge by mistake, and a divergence is the silent failure above.
export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? "http://localhost:3002";
}
