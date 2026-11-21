"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSetupState } from "@/lib/setup-state/use-setup-state";

/** Restore the workflow only after its prerequisite has actually been saved. */
export function ReturnAfterSetup() {
  const pathname = usePathname();
  const router = useRouter();
  const { setupState } = useSetupState();
  useEffect(() => {
    if (!setupState) return;
    try {
      const raw = window.sessionStorage.getItem("schoolkit:setup-return");
      if (!raw) return;
      const pending = JSON.parse(raw) as { from: string; stepKey: string; destination: string };
      if (pathname !== pending.destination) return;
      const step = setupState.steps.find((item) => item.key === pending.stepKey);
      if (!step?.done || !pending.from.startsWith("/") || pending.from.startsWith("//")) return;
      window.sessionStorage.removeItem("schoolkit:setup-return");
      router.replace(pending.from);
    } catch { /* Malformed or unavailable browser storage must not block setup. */ }
  }, [pathname, router, setupState]);
  return null;
}
