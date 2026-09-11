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
// Callers still to migrate onto this helper: guardians.service.ts,
// portal-auth.service.ts, portal-payments.service.ts. Each holds its own
// identical copy of the fallback string. Left alone deliberately — they are
// outside this change's scope — but they belong here.
export function portalBaseUrl(): string {
  return process.env.PORTAL_BASE_URL ?? "http://localhost:3002";
}
