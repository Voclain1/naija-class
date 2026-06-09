"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/use-auth";

import { BrandLoadingScreen } from "../brand-loading-screen";

// Client-side gate wrapping any (admin) page. Three states like before, with
// an extra branch for ONBOARDING schools so the dashboard becomes structurally
// unreachable until the wizard is done.
//
//   loading    → branded loading screen.
//   guest      → router.replace('/login').
//   ONBOARDING → router.replace('/onboarding/<onboardingStep + 1>').
//                We compute the next un-completed step from the auth context;
//                the API's gate is the source of truth, this redirect just
//                stops the user landing on /dashboard between completing the
//                wizard and the next /auth/me refresh.
//   ACTIVE     → render children.
//
// Clamp to 5 so a future bug that lands the user at onboardingStep=5 while
// still ONBOARDING does not produce /onboarding/6 (route does not exist).
//
// `roles` (optional): restrict the subtree to users holding one of these role
// keys. Used by the (admin) layout to keep teachers out of the admin shell —
// a teacher hitting an (admin) route bounces to /teacher. The server is the
// real gate (every admin mutation re-checks the role); this just stops the
// wrong shell from rendering. Omit `roles` to allow any authed user (the
// (teacher) layout does this — owner/admin may view teacher pages too).
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { status, school, roles: userRoles } = useAuth();
  const router = useRouter();

  // Authed + onboarded but lacking a required role → not allowed in this shell.
  const lacksRole =
    roles !== undefined &&
    status === "authed" &&
    school?.status !== "ONBOARDING" &&
    !userRoles.some((r) => roles.includes(r.key));

  useEffect(() => {
    if (status === "guest") {
      router.replace("/login");
      return;
    }
    if (status === "authed" && school?.status === "ONBOARDING") {
      const nextStep = Math.min((school.onboardingStep ?? 0) + 1, 5);
      router.replace(`/onboarding/${nextStep}`);
      return;
    }
    if (lacksRole) {
      router.replace("/teacher/dashboard");
    }
  }, [status, school, router, lacksRole]);

  if (status !== "authed") {
    return <BrandLoadingScreen />;
  }
  if (school?.status === "ONBOARDING") {
    // Render the loading screen for the redirect tick so the user doesn't see
    // a flash of the dashboard shell before the navigation completes.
    return <BrandLoadingScreen />;
  }
  if (lacksRole) {
    // Same flash-prevention for the wrong-role redirect tick.
    return <BrandLoadingScreen />;
  }

  return <>{children}</>;
}
