"use client";

import { Check, ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import type { SetupStepDto, SetupStepTier } from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  checklistProgress,
  doneSummary,
  shouldShowChecklist,
} from "@/lib/setup-state/checklist-presentation";
import { useSetupState } from "@/lib/setup-state/use-setup-state";

// The dashboard setup checklist (F-25).
//
// WHY A CHECKLIST AND NOT A WIZARD. The five-step wizard already exists and
// already covers the part of setup that genuinely must happen in one sitting
// and in one order (school basics through the academic calendar) — and it is
// deliberately not skippable. Everything AFTER it is not like that: adding
// students, pricing fees and inviting teachers are days-long, delegable jobs
// that a proprietor does between other work, often from different screens,
// sometimes by CSV. A second wizard would have to be abandonable to be
// usable, and an abandonable wizard is a checklist with worse ergonomics.
// So: a card that remembers nothing, because it reads everything.
//
// LEAVE AND RETURN IS FREE. Every tick is a live count from the API (see
// SetupStateService) — there is no progress to lose, no resume point to
// store, and no way for this to claim something is done that is not.
//
// SUPPRESSION IS BACKEND-DERIVED. `status` comes from the API: "setup" while
// a required step is outstanding, "finishing" while only recommended work
// remains and the school has no real activity, "established" otherwise. An
// established school renders nothing at all from this file — there is no
// dismiss button, because a dismissal would be exactly the browser-only
// fake state this design rules out.
const TIER_ORDER: SetupStepTier[] = ["required", "recommended", "optional"];

const TIER_HEADINGS: Record<SetupStepTier, { title: string; blurb: string }> = {
  required: {
    title: "Do these first",
    blurb: "The school cannot run day to day until these are done.",
  },
  recommended: {
    title: "Do these when you can",
    blurb: "Each one unlocks a part of the app. You can still work without them.",
  },
  optional: {
    title: "These can wait",
    blurb: "Nothing is blocked. Come back to these whenever it suits you.",
  },
};

export function SetupChecklist() {
  const { setupState } = useSetupState();
  // Optional steps and the "already done for you" list start folded away.
  // The point of the card is the short list of things that matter now; the
  // rest is there for an owner who goes looking, not in their face.
  const [showRest, setShowRest] = useState(false);

  if (!shouldShowChecklist(setupState) || !setupState) return null;

  const { steps, status, requiredRemaining, nextStepKey, alreadyDone } = setupState;
  const nextStep = steps.find((s) => s.key === nextStepKey) ?? null;
  const progress = checklistProgress(steps);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {status === "setup" ? "Finish setting up your school" : "A few things left to set up"}
        </CardTitle>
        <CardDescription>
          {requiredRemaining > 0 ? (
            <>
              {requiredRemaining === 1
                ? "One thing still has to be done"
                : `${requiredRemaining} things still have to be done`}{" "}
              before you can run registers, invoices, or report cards.
            </>
          ) : (
            <>
              The essentials are done. What is left below improves things but does not hold you
              up.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {/* Progress. Deliberately counts required + recommended only —
            including optional steps would make a fully-working school look
            unfinished forever. */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-foreground">
              {progress.done} of {progress.total} done
            </span>
            {nextStep && (
              <span className="text-muted-foreground">Next: {nextStep.title.toLowerCase()}</span>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>

        {TIER_ORDER.filter((tier) => tier !== "optional" || showRest).map((tier) => {
          const tierSteps = steps.filter((s) => s.tier === tier);
          if (tierSteps.length === 0) return null;
          return (
            <section key={tier} className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  {TIER_HEADINGS[tier].title}
                </h3>
                <p className="text-sm text-muted-foreground">{TIER_HEADINGS[tier].blurb}</p>
              </div>
              <ul className="flex flex-col gap-2">
                {tierSteps.map((step) => (
                  <StepRow key={step.key} step={step} highlight={step.key === nextStepKey} />
                ))}
              </ul>
            </section>
          );
        })}

        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setShowRest((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline"
          >
            {showRest ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {showRest ? "Hide" : "Show"} what can wait, and what we set up for you
          </button>

          {showRest && (
            <div className="mt-4 flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">Already set up for you</h3>
              <ul className="flex flex-col gap-2">
                {alreadyDone.map((item) => (
                  <li key={item.label} className="flex gap-3 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      <Link href={item.href} className="font-medium hover:underline">
                        {item.label}
                      </Link>
                      <span className="block text-muted-foreground">{item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StepRow({ step, highlight }: { step: SetupStepDto; highlight: boolean }) {
  return (
    <li
      data-testid={`setup-step-${step.key}`}
      data-done={step.done ? "true" : "false"}
      className={[
        "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between",
        step.done ? "border-border bg-muted/30" : "border-border bg-card",
        highlight ? "ring-1 ring-primary/40" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden
          className={[
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
            step.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
          ].join(" ")}
        >
          {step.done && <Check className="h-3 w-3" />}
        </span>
        <div className="min-w-0">
          <p
            className={[
              "text-sm font-medium",
              step.done ? "text-muted-foreground line-through" : "text-foreground",
            ].join(" ")}
          >
            {step.title}
          </p>
          {/* An incomplete step explains why it matters; a completed one
              reports what was found instead, so a tick is evidence rather
              than a claim. */}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {step.done ? doneSummary(step) : step.why}
          </p>
        </div>
      </div>
      {!step.done && (
        <Button asChild size="sm" variant={highlight ? "default" : "outline"} className="shrink-0">
          <Link href={step.href}>{step.actionLabel}</Link>
        </Button>
      )}
    </li>
  );
}

