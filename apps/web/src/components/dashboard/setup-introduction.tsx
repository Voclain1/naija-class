"use client";

import { useEffect, useState } from "react";
import { SetupChecklist } from "@/components/setup/setup-checklist";
import type { useSetupState } from "@/lib/setup-state/use-setup-state";

// Non-sensitive, school-scoped UX preference: the introduction appears once
// per browser and school, not at every login. It never gates navigation.
export function SetupIntroduction({ setup, schoolId }: { setup: ReturnType<typeof useSetupState>; schoolId: string }) {
  const [remaining, setRemaining] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!schoolId || !setup.setupState || setup.setupState.status === "established") return;
    const key = `schoolkit:setup-intro:v1:${schoolId}`;
    try { if (window.localStorage.getItem(key)) return; window.localStorage.setItem(key, "seen"); } catch { /* private browsing: still allow dismissal */ }
    setRemaining(5);
    setVisible(true);
    const interval = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    const timeout = window.setTimeout(() => setVisible(false), 5000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [schoolId, setup.setupState]);
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="School setup introduction">
      <div className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-4 shadow-xl sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold">Welcome to your school dashboard</h2><p className="text-sm text-muted-foreground">You can explore SchoolKit while finishing setup.</p></div>
          <button type="button" onClick={() => setVisible(false)} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to dashboard now</button>
        </div>
        <p role="timer" aria-live="off" className="mb-3 text-sm text-muted-foreground">Dashboard opens in <span className="font-semibold tabular-nums">{remaining}</span> seconds</p>
        <SetupChecklist setup={setup} />
      </div>
    </div>
  );
}
