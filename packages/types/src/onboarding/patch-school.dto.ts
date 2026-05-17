import { z } from "zod";

import { onboardingStep1Schema } from "./step1-basics.dto.js";
import { onboardingStep2Schema } from "./step2-branding.dto.js";

// PATCH /schools/me — partial update of basics + branding by owner/admin.
// Distinct from the wizard's step endpoints: PATCH is the everyday "edit
// school details" path, accessible after onboarding (and during, via the
// wizard's go-back-to-edit affordance). It does NOT touch onboarding_step
// or status — those are wizard-only state transitions.
//
// We compose by merging the step 1 and step 2 schemas and calling
// .partial() so the caller can update any subset. .strict() so a typo
// (`primary_color` vs `primaryColor`) is a 400 rather than a silent no-op.
//
// At least one field is required — sending {} would still pass the merged
// partial — so we tack a refine on the bottom.
export const patchSchoolSchema = onboardingStep1Schema
  .merge(onboardingStep2Schema)
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "at least one field is required",
  });

export type PatchSchoolInput = z.infer<typeof patchSchoolSchema>;
