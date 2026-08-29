"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import type { SetupStepKey } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { findStep, useSetupState } from "@/lib/setup-state/use-setup-state";

// The other half of the F-25 fix: when a workflow cannot do anything yet,
// say which earlier step is missing instead of rendering a plausible-looking
// screen that silently does nothing.
//
// WHAT THIS IS NOT. It is not a route guard. Every screen this appears on
// stays fully reachable and fully interactive — an owner who wants to look
// around a class board with nobody in it still can, and an owner who is
// about to enrol students should not be bounced out of the screen they are
// heading for. The notice sits above the screen's own content and explains;
// it never replaces or disables it. Blocking a route that can genuinely
// function is the failure this slice was asked to avoid, not commit.
//
// WHAT IT DOES NOT SAY. Nothing here mentions tables, IDs, records, or
// "configuration". The step copy comes from the API in the same plain
// language the checklist uses, so the two can never drift into describing
// the same missing thing two different ways.
//
// Renders nothing when: the viewer is not owner/admin (a bursar cannot fix
// any of this and gets the screen's own empty state), the step is already
// done, or the state failed to load.
export function PrerequisiteNotice({
  stepKey,
  because,
  onlyAfter,
}: {
  stepKey: SetupStepKey;
  /**
   * What this particular screen cannot do yet, in the screen's own terms —
   * e.g. "There is nobody to mark present". The step's own `why` explains
   * the missing piece; this explains the consequence here.
   */
  because: string;
  /**
   * Suppress until this earlier step is done. Used on screens where the
   * prompt would otherwise arrive too early — telling someone on an empty
   * Students page to go and enrol students is noise, but telling them the
   * moment they have a roster is the handover the product was missing.
   */
  onlyAfter?: SetupStepKey;
}) {
  const { setupState } = useSetupState();
  const step = findStep(setupState, stepKey);
  const gate = onlyAfter ? findStep(setupState, onlyAfter) : null;

  if (!step || step.done) return null;
  if (onlyAfter && !gate?.done) return null;

  return (
    <div
      data-testid={`prerequisite-${stepKey}`}
      className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-md border border-secondary/50 bg-secondary/10 px-4 py-3"
    >
      <div className="flex min-w-0 gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{because}</p>
          <p className="mt-1 text-sm text-muted-foreground">{step.why}</p>
        </div>
      </div>
      <Button asChild size="sm" className="shrink-0">
        <Link href={step.href}>{step.actionLabel}</Link>
      </Button>
    </div>
  );
}
