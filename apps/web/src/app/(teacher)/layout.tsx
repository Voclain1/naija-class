import type { ReactNode } from "react";

import { AdminTopbar } from "@/components/admin/topbar";
import { RequireAuth } from "@/components/auth/require-auth";
import { TeacherSidebar } from "@/components/teacher/sidebar";

// (teacher) route group — Phase 1 / Slice 10 cp3. The teacher portal proper
// (timetable, gradebook, etc.) arrives in later slices; cp3 introduces the
// group with a single self-service surface: /teacher/profile.
//
// ROUTING GUARD: `(teacher)` is a route GROUP — Next.js strips it from the
// URL. Pages must live under the REAL `teacher/` segment nested inside this
// group (e.g. `(teacher)/teacher/profile/page.tsx` → `/teacher/profile`), NOT
// directly here (`(teacher)/profile/page.tsx` would serve `/profile` and a
// `(teacher)/dashboard/page.tsx` would serve `/dashboard` — colliding with
// the admin dashboard). cp3 shipped the page in the wrong place first and it
// 404'd; see CLAUDE.md "Next.js route groups vs URL segments". Slice 11's
// /teacher/dashboard + /teacher/classes go under `(teacher)/teacher/…` too.
//
// We reuse RequireAuth (authed + ACTIVE school gate — same requirement for a
// teacher as for an admin) and the generic AdminTopbar (school name + user
// menu + logout; no admin-only links). The nav is the slice-11 TeacherSidebar
// (Dashboard / Classes / Profile) — deliberately NOT the admin sidebar, so a
// teacher never sees Students / Staff / Academics / Settings. Same shell shape
// as the (admin) layout (sidebar + topbar + main).
export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-muted/30">
        <TeacherSidebar />
        <div className="flex flex-1 flex-col">
          <AdminTopbar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
