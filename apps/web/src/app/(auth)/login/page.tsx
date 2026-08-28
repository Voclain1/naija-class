import { Suspense } from "react";

import { LoginForm } from "@/components/auth/login-form";

// LoginForm reads `reason` and `next` from the query string via
// useSearchParams (F-10 — see lib/auth/session-end.ts). In the App Router
// that hook MUST sit inside a Suspense boundary: without one, Next opts the
// whole route into client-side rendering and the page can be left suspended
// rather than interactive.
//
// This is the same boundary apps/portal's login page already has, for the
// same reason. Added here after its absence made the login form unusable —
// the Phase 0 happy-path e2e (signup -> onboarding -> invite -> accept ->
// login) timed out on the final step.
//
// fallback={null}: the form is the entire page, so a skeleton would just
// flash. The gap is a few milliseconds of blank card area.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
