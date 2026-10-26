"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { BookSetupCall } from "@/components/onboarding/book-setup-call";

// The setup-call page shown once after the setup wizard
// (docs/modules/onboarding-call.md). Full screen, no admin chrome.
export default function WelcomePage() {
  return (
    <RequireAuth>
      <BookSetupCall />
    </RequireAuth>
  );
}
