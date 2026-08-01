import type { ReactNode } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";

// Onboarding wizard layout. Centered card layout like (auth), no admin
// chrome (sidebar/topbar) since the user has not finished setup yet.
//
// The per-page header (which includes the progress indicator) lives in the
// step pages themselves so it can show the right currentStep without prop
// drilling through the layout.
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <SchoolKitWordmark iconSize={32} textClassName="text-2xl" />
        <p className="text-sm text-muted-foreground">Let&apos;s set up your school.</p>
      </div>
      {children}
    </div>
  );
}
