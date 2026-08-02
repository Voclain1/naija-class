"use client";

import { useState, type ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";
import { TourProvider, useTour } from "@/components/tour/first-login-tour";

export default function AdminLayout({ children }: { children: ReactNode }) {
  // Owned here (not inside AdminTopbar) so FirstLoginTour can also force the
  // mobile drawer open/closed on narrow viewports — see MobileNav's and
  // AdminTopbar's header comments for the full chain.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    // Owner/admin/bursar — a teacher hitting any (admin) route bounces to
    // /teacher (the server re-checks every mutation; this keeps the admin
    // shell from rendering for the wrong role). Bursar was added here
    // 2026-08-02: the role shipped in Phase 3/Slice 15 with real finance
    // permissions, but this gate was never updated to match, so a bursar
    // hitting /finance/* (or any other (admin) route) got redirected to
    // /teacher/dashboard with no way back in — a real functional bug, not a
    // deliberate scope decision. useVisibleAdminNavItems() (sidebar.tsx) is
    // the other half of the fix: it filters NAV_ITEMS by permission so a
    // bursar who now reaches this shell only sees Finance, not
    // Students/Staff/Academics/Settings they have no permission for.
    <RequireAuth roles={["owner", "admin", "bursar"]}>
      <TourProvider mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen}>
        <AdminShell mobileNavOpen={mobileNavOpen} setMobileNavOpen={setMobileNavOpen}>
          {children}
        </AdminShell>
      </TourProvider>
    </RequireAuth>
  );
}

// Split out from AdminLayout so it can call useTour() — that hook throws
// outside <TourProvider>, and AdminLayout itself renders the provider, so
// the consumer has to be a child, not the same component.
function AdminShell({
  mobileNavOpen,
  setMobileNavOpen,
  children,
}: {
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  const { active: tourActive, skip: skipTour, startReplay } = useTour();

  // Every MobileNav-originated dismiss (Escape, backdrop click, route
  // change, the X button) calls this with `false`. While the tour is
  // driving the drawer, that "please close" request means "skip the tour"
  // (which itself closes the drawer as part of dismissing) — not just
  // "close the drawer and leave the tooltip pointing at nothing".
  function handleMobileNavOpenChange(next: boolean) {
    if (!next && tourActive) {
      skipTour();
      return;
    }
    setMobileNavOpen(next);
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          mobileNavOpen={mobileNavOpen}
          onMobileNavOpenChange={handleMobileNavOpenChange}
          onReplayTour={startReplay}
        />
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
