import { z } from "zod";

// Step 4 — NDPR consent re-confirmation. Signup already required this
// (signupOwnerSchema → ndprConsent: literal(true)), and that's why
// schools.ndpr_consent is true straight out of the signup transaction.
//
// Re-asking here is deliberate, not redundant: the wizard surfaces the
// privacy policy text in plain language to the school owner before they
// can finish onboarding, so they cannot claim "I never saw it" — at this
// step we re-stamp ndpr_consent_at to the wizard-completion moment, which
// is the timestamp a future compliance audit would care about, not the
// signup-form click.
export const onboardingStep4Schema = z.object({
  ndprConsent: z.literal(true, {
    errorMap: () => ({ message: "NDPR consent is required to finish onboarding" }),
  }),
});

export type OnboardingStep4Input = z.infer<typeof onboardingStep4Schema>;
