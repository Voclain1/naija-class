import { z } from "zod";

// Step 5 — Complete. No payload; the only thing this endpoint does on the
// server is flip school.status from ONBOARDING to ACTIVE (and bump
// onboarding_step to 5). The frontend POSTs an empty body when the user
// clicks "Go to dashboard" on the success screen.
//
// We still validate against a schema (rather than skipping the pipe) so
// `{ stowaway: "field" }` is rejected with VALIDATION_ERROR instead of
// silently accepted — `.strict()` makes that explicit.
export const onboardingStep5Schema = z.object({}).strict();

export type OnboardingStep5Input = z.infer<typeof onboardingStep5Schema>;
