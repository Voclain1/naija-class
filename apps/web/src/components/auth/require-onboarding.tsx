"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/lib/auth/use-auth";

import { BrandLoadingScreen } from "../brand-loading-screen";

// Mirror of RequireAuth for the (onboarding) route group. Four branches:
//
//   loading        → loading screen.
//   guest          → /signup (onboarding is only reachable after signup; a
//                    guest here hasn't created an account yet, not forgotten
//                    their password — sending them to /login would confuse).
//   ACTIVE school  → /dashboard (don't let the user re-walk a finished wizard).
//   ONBOARDING     → enforce the same "you can only access the next un-completed
//                    step, or any previous step" rule the backend enforces.
//                    The "required" step is `onboardingStep + 1`; trying to
//                    access a step > required is a forward-jump → redirect to
//                    the required step. Step <= required is allowed (the user
//                    can revisit a previous step to edit).
//
// The page passes the step it represents as `currentStep` so the gate has the
// information it needs without parsing the URL itself.
export function RequireOnboarding({
  currentStep,
  children,
}: {
  currentStep: number;
  children: ReactNode;
}) {
  const { status, school } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "guest") {
      router.replace("/signup");
      return;
    }
    if (status === "authed") {
      if (school?.status === "ACTIVE") {
        router.replace("/dashboard");
        return;
      }
      if (school?.status === "ONBOARDING") {
        const requiredStep = Math.min((school.onboardingStep ?? 0) + 1, 5);
        if (currentStep > requiredStep) {
          router.replace(`/onboarding/${requiredStep}`);
        }
      }
    }
  }, [status, school, currentStep, router]);

  if (status !== "authed") return <BrandLoadingScreen />;
  if (school?.status === "ACTIVE") return <BrandLoadingScreen />;

  if (school?.status === "ONBOARDING") {
    const requiredStep = Math.min((school.onboardingStep ?? 0) + 1, 5);
    if (currentStep > requiredStep) return <BrandLoadingScreen />;
  }

  return <>{children}</>;
}
