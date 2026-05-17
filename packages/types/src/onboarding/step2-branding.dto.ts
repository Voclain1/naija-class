import { z } from "zod";

// Six-digit hex colour. Lowercase or uppercase both fine; the # is required
// (mirrors how the value will be consumed in CSS — applying it via Phase 2
// theming wants the value to be a complete CSS colour, not a fragment).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Step 2 — Branding. Both fields optional: a school that doesn't yet have a
// logo or hasn't decided on a colour can submit an empty payload and still
// advance to step 3. Real R2 upload is deferred — see docs/deferred.md.
// For now logoUrl is just a URL string the user pastes in (or leaves blank).
export const onboardingStep2Schema = z.object({
  logoUrl: z.string().trim().url().max(500).optional(),
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_RE, "primaryColor must be a 6-digit hex colour, e.g. #1A2B3C")
    .optional(),
});

export type OnboardingStep2Input = z.infer<typeof onboardingStep2Schema>;
