"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import type { OnboardingCallStateDto } from "@school-kit/types";

import { BrandLoadingScreen } from "@/components/brand-loading-screen";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth/use-auth";

// An owner who left before booking or skipping the setup call (signed out, or
// opened a page directly) is taken back to it (docs/modules/onboarding-call.md).
// A gate rather than a redirect after render: the admin screens would
// otherwise start their own navigation (the term selector rewrites the
// dashboard's address) and win the race. Once the answer is "not shown", it is
// remembered for the browser session, so later page loads do not wait on it.
// Nobody but the owner is asked.

const SEEN_KEY = "sk_setup_call_checked";

function alreadyChecked(schoolId: string): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === schoolId;
  } catch {
    return false;
  }
}

function remember(schoolId: string) {
  try {
    sessionStorage.setItem(SEEN_KEY, schoolId);
  } catch {
    // Private mode: the check simply runs again next time.
  }
}

export function SetupCallGate({ children }: { children: ReactNode }) {
  const { roles, school } = useAuth();
  const router = useRouter();
  const schoolId = school?.id ?? "";
  const isOwner = roles.some((r) => r.key === "owner");
  const [state, setState] = useState<"checking" | "pass" | "redirect">(() =>
    !isOwner || !schoolId || alreadyChecked(schoolId) ? "pass" : "checking",
  );

  useEffect(() => {
    if (state !== "checking") return;
    let current = true;
    apiFetch<OnboardingCallStateDto>("/schools/me/onboarding-call")
      .then((s) => {
        if (!current) return;
        if (s.show) {
          setState("redirect");
          router.replace("/welcome");
        } else {
          remember(schoolId);
          setState("pass");
        }
      })
      // A failed check never blocks the school's own screens.
      .catch(() => current && setState("pass"));
    return () => {
      current = false;
    };
  }, [state, schoolId, router]);

  if (state !== "pass") return <BrandLoadingScreen />;
  return <>{children}</>;
}
