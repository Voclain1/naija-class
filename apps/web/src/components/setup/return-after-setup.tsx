"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/use-auth";
import { getSetupState } from "@/lib/setup-state/setup-state-api";

type PendingReturn = { from: string; stepKey: string; destination: string };

function readPending(): PendingReturn | null {
  try {
    const raw = window.sessionStorage.getItem("schoolkit:setup-return");
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const p = value as Partial<PendingReturn>;
    if (typeof p.from !== "string" || typeof p.stepKey !== "string" || typeof p.destination !== "string") return null;
    if (!p.from.startsWith("/") || p.from.startsWith("//") || p.from.includes("\\\\")) return null;
    return p as PendingReturn;
  } catch { return null; }
}

/** Return only after the API confirms the required setup step was completed. */
export function ReturnAfterSetup() {
  const pathname = usePathname();
  const router = useRouter();
  const { roles, school } = useAuth();
  const canSetUp = roles.some((role) => role.key === "owner" || role.key === "admin");

  useEffect(() => {
    if (!canSetUp || school?.status !== "ACTIVE") return;
    const pending = readPending();
    if (!pending || pending.destination !== pathname) return;
    let cancelled = false;
    let busy = false;
    const check = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        const state = await getSetupState();
        if (cancelled) return;
        const done = state.steps.some((step) => step.key === pending.stepKey && step.done);
        if (!done) return;
        window.sessionStorage.removeItem("schoolkit:setup-return");
        router.replace(pending.from);
      } catch { /* Keep setup usable when status fetch is temporarily unavailable. */ }
      finally { busy = false; }
    };
    void check();
    const interval = window.setInterval(() => { void check(); }, 2500);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [canSetUp, pathname, router, school?.status]);

  return null;
}
