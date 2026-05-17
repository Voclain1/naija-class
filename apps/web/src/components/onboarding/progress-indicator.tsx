// Five-dot progress indicator. Visible across all wizard pages so the user
// always knows where they are in the flow. Numbers are derived from
// currentStep; we render labels for accessibility (screen readers will
// announce "step 2 of 5, current").

import { cn } from "@/lib/utils";

const STEP_LABELS = ["Basics", "Branding", "Invites", "NDPR", "Complete"];

export function OnboardingProgress({ currentStep }: { currentStep: number }) {
  return (
    <ol
      className="flex w-full items-center justify-between gap-2"
      aria-label={`Onboarding progress: step ${currentStep} of 5`}
    >
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const state = step < currentStep ? "done" : step === currentStep ? "current" : "future";
        return (
          <li
            key={label}
            className="flex flex-1 flex-col items-center gap-1"
            aria-current={state === "current" ? "step" : undefined}
          >
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "current" && "border-primary text-primary",
                state === "future" && "border-muted-foreground/30 text-muted-foreground/60",
              )}
            >
              {step}
            </span>
            <span
              className={cn(
                "text-[11px] leading-none",
                state === "future" ? "text-muted-foreground/60" : "text-foreground/80",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
