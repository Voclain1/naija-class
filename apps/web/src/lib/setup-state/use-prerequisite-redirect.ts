"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { SetupStepKey } from "@school-kit/types";
import { useSetupState } from "./use-setup-state";

/** Redirect only when the requested workflow has no usable school data yet.
 * Do not redirect established schools or users who cannot configure setup.
 * The setup-state API supplies the authoritative action URL.
 */
export function usePrerequisiteRedirect(keys: readonly SetupStepKey[]): boolean {
  const { setupState, canSetUp } = useSetupState();
  const router = useRouter();
  const pathname = usePathname();
  const missing = canSetUp && setupState && !setupState.hasRealActivity
    ? keys.map((key) => setupState.steps.find((step) => step.key === key))
        .find((step) => step && !step.done && step.href !== pathname)
    : null;

  useEffect(() => {
    if (!missing) return;
    // The destination is an existing, API-defined setup step, never user input.
    const url = new URL(missing.href, window.location.origin);
    url.searchParams.set("setupFrom", pathname);
    try {
      window.sessionStorage.setItem("schoolkit:setup-return", JSON.stringify({ from: pathname, stepKey: missing.key, destination: url.pathname }));
    } catch { /* Storage is optional; setup still works without it. */ }
    router.replace(url.pathname + url.search);
  }, [missing, pathname, router]);

  return Boolean(missing);
}
