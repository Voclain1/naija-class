import type { ReactNode } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <SchoolKitWordmark iconSize={40} textClassName="text-2xl" />
        {/* Plain-language tagline. Was "Multi-tenant school management" until
            2026-08-09 — an architecture term on the first screen every school
            owner, bursar and teacher ever sees. Keep this in the reader's
            vocabulary, not ours. */}
        <p className="text-sm text-muted-foreground">
          Run your school in one place
        </p>
      </div>
      {children}
    </div>
  );
}
