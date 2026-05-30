import type { ReactNode } from "react";

import { AdminTopbar } from "@/components/admin/topbar";
import { RequireAuth } from "@/components/auth/require-auth";

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
// menu + logout; no admin-only links), but deliberately NOT the admin sidebar
// — teachers don't get the admin IA. A richer teacher nav lands with the rest
// of the portal in slice 11+.
export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen flex-col bg-muted/30">
        <AdminTopbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </RequireAuth>
  );
}
