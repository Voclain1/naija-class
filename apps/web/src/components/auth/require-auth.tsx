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
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, school } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "guest") {
      router.replace("/login");
      return;
    }
    if (status === "authed" && school?.status === "ONBOARDING") {
      const nextStep = Math.min((school.onboardingStep ?? 0) + 1, 5);
      router.replace(`/onboarding/${nextStep}`);
    }
  }, [status, school, router]);

  if (status !== "authed") {
    return <BrandLoadingScreen />;
  }
  if (school?.status === "ONBOARDING") {
    // Render the loading screen for the redirect tick so the user doesn't see
    // a flash of the dashboard shell before the navigation completes.
    return <BrandLoadingScreen />;
  }

  return <>{children}</>;
}
