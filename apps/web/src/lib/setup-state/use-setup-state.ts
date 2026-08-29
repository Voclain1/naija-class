"use client";

import { useEffect, useState } from "react";

import type { SetupStateDto, SetupStepDto, SetupStepKey } from "@school-kit/types";

import { useAuth } from "@/lib/auth/use-auth";

import { getSetupState } from "./setup-state-api";

// Shared loader for every surface that needs to know how far a school has
// got: the dashboard checklist and each workflow screen's prerequisite
// notice.
//
// ROLE GATE LIVES HERE, once. The API is owner/admin only, so a bursar
// mounting a screen that happens to render a prerequisite notice would
// otherwise fire a request that 403s on every page load. `canSetUp` is
// false for them and no request is made — they get the screen's own empty
// state instead, which is the right outcome: a bursar cannot fix a missing
// class list and should not be told to.
//
// No react-query: this is one cheap GET with no mutation, no cache
// invalidation story, and two call sites. Following dashboard-api.ts's
// plain-fetch shape keeps it consistent with its neighbours.
export function useSetupState(): {
  setupState: SetupStateDto | null;
  loading: boolean;
  canSetUp: boolean;
} {
  const { roles, school } = useAuth();
  const canSetUp = roles.some((r) => r.key === "owner" || r.key === "admin");

  const [setupState, setSetupState] = useState<SetupStateDto | null>(null);
  const [loading, setLoading] = useState(canSetUp);

  useEffect(() => {
    // A school still in the wizard gets onboarding step 5, not this. Showing
    // both would be two setup surfaces for one school — the same call
    // CalendarSetupPrompt makes.
    if (!canSetUp || !school || school.status !== "ACTIVE") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getSetupState()
      .then((res) => {
        if (!cancelled) setSetupState(res);
      })
      .catch(() => {
        // Never let this block the page it sits on. A failed load leaves
        // setupState null, and every consumer renders nothing rather than an
        // error — the checklist is guidance, not content.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canSetUp, school]);

  return { setupState, loading, canSetUp };
}

// Look up one step. Used by the prerequisite notices, which each care about
// a specific step rather than the whole list.
export function findStep(
  state: SetupStateDto | null,
  key: SetupStepKey,
): SetupStepDto | null {
  return state?.steps.find((s) => s.key === key) ?? null;
}
