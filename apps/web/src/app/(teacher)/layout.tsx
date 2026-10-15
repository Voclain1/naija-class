import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { TeacherSidebar } from "@/components/teacher/sidebar";
import { TeacherTopbar } from "@/components/teacher/topbar";

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
// teacher as for an admin) and TeacherTopbar (a thin wrapper around the
// shared AdminTopbar — school name + user menu + logout; no admin-only
// links — that also supplies the teacher's own nav list for the mobile
// hamburger drawer, see components/teacher/topbar.tsx). The desktop nav is
// the slice-11 TeacherSidebar (Dashboard / Classes / Profile) — deliberately
// NOT the admin sidebar, so a teacher never sees Students / Staff /
// Academics / Settings; TeacherTopbar keeps the mobile drawer in sync with
// that same list. Same shell shape as the (admin) layout (sidebar + topbar +
// main).
//
// The sidebar's print wrapper is `flex` so the sidebar stretches to the full
// height of the shell; as a plain block it was only as tall as its links, and
// on a short page its background stopped partway down (2026-10-12).
export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-muted/30">
        <div className="flex print:hidden">
          <TeacherSidebar />
        </div>
        {/* min-w-0, as in the admin shell (#412): without it this column grows
            to fit a wide table and the whole page scrolls sideways on a phone. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="print:hidden">
            <TeacherTopbar />
          </div>
          <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 print:p-0">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
