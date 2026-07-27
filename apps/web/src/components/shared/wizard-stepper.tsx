import { cn } from "@/lib/utils";

// Phase 2 (Students & Staff restyle) — shared visual stepper for the CSV
// import wizards. Replaces two duplicated patterns that predate the design
// system: the plain "Step X of 4" text label each upload page hand-rolled,
// and `Wizard.Header` (@/lib/imports/wizard-ui.tsx) — text-only, no visual
// progress. Generalizes onboarding's dot-progress pattern
// (components/onboarding/progress-indicator.tsx) so it isn't onboarding-only.
//
// Wired into the Students and Staff wizards now; the Guardian wizard keeps
// using the old `Wizard.Header` until its own restyle pass swaps it in —
// same "reuse later, don't touch what you're not restyling" discipline the
// Finance pass used for BvnCaptureModal/BvnRevealModal (see their own
// migration to the Dialog primitive in this same phase).
export interface WizardStepperProps {
  steps: readonly string[];
  currentStep: number; // 1-indexed
  title: string;
}

export function WizardStepper({ steps, currentStep, title }: WizardStepperProps) {
  return (
    <header className="flex flex-col gap-4">
      <ol
        className="flex w-full items-center gap-2"
        aria-label={`Step ${currentStep} of ${steps.length}: ${title}`}
      >
        {steps.map((label, index) => {
          const step = index + 1;
          const state = step < currentStep ? "done" : step === currentStep ? "current" : "future";
          return (
            <li
              key={label}
              className={cn("flex items-center gap-2", step < steps.length && "flex-1")}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary text-primary",
                  state === "future" && "border-muted-foreground/30 text-muted-foreground/60",
                )}
              >
                {step}
              </span>
              <span
                className={cn(
                  "hidden text-xs sm:inline",
                  state === "future" ? "text-muted-foreground/60" : "text-foreground/80",
                )}
              >
                {label}
              </span>
              {step < steps.length && (
                <span
                  className={cn(
                    "mx-1 h-px flex-1",
                    step < currentStep ? "bg-primary" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">{title}</h1>
    </header>
  );
}

// Default 4-step label set shared by every CSV import wizard (upload → map
// → review → commit). A wizard whose wording differs (teacher import says
// "Invite" not "Import") still fits these generic labels — the per-step
// `title` prop is what carries the specific copy.
export const IMPORT_WIZARD_STEPS = ["Upload", "Map columns", "Review", "Import"] as const;
