"use client";

import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { HelpTopbar } from "@/components/help/help-topbar";

// /help/* — deliberately outside both (admin) and (teacher) route groups.
// Owner, admin, bursar, and teacher can all reach the getting-started guide
// (see Help icon in AdminTopbar/TeacherTopbar), so this can't live inside
// either role-scoped shell without either duplicating the page under both
// groups or showing the wrong sidebar to half its visitors. No `roles` on
// RequireAuth -> any authed user, same as the (teacher) layout.
export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col bg-muted/30">
        <HelpTopbar />
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
