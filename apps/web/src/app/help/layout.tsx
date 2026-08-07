"use client";

import type { ReactNode } from "react";

import { HelpTopbar } from "@/components/help/help-topbar";

// /help/* — deliberately outside both (admin) and (teacher) route groups.
// Owner, admin, bursar, and teacher can all reach the getting-started guide
// (see Help icon in AdminTopbar/TeacherTopbar), so this can't live inside
// either role-scoped shell without either duplicating the page under both
// groups or showing the wrong sidebar to half its visitors.
//
// Deliberately NO RequireAuth here (2026-08-07): /help/guide must be
// reachable by non-users too — someone can be sent the link before ever
// signing up. middleware.ts's matcher already omits /help/:path*, so this
// layout was the only gate; removing it makes the whole /help/* subtree
// public. HelpTopbar still renders for signed-in visitors (useAuth() drops
// to a harmless guest state — blank name/school, "Back" and "Log out" both
// degrade to routing at/through /login — for anonymous ones), so no other
// change was needed for it to work either way.
export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <HelpTopbar />
      <main className="flex-1 p-4 sm:p-6">{children}</main>
    </div>
  );
}
