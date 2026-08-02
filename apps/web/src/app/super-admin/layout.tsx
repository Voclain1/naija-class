import type { ReactNode } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";

// Genuinely separate top-level surface — shares the Next.js root layout
// (fonts, providers) because this route lives inside apps/web, not a
// separate app, but deliberately does NOT share (admin)'s RequireAuth-
// wrapped shell (sidebar nav, role gate) or (teacher)'s. No nav link to
// this route exists anywhere in that shell.
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <SchoolKitWordmark iconSize={40} textClassName="text-2xl" />
        <p className="text-sm text-muted-foreground">Platform admin — internal only</p>
      </div>
      {children}
    </div>
  );
}
