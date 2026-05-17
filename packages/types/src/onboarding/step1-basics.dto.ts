import { z } from "zod";

// Shared regexes — mirror the signup DTO so phone validation stays consistent
// across the two entry points. Real country/MNO validation lands in Phase 3.
const PHONE_RE = /^\+?[0-9]{10,15}$/;

// Step 1 — School basics. Required: name, phone, email. Optional: motto,
// address. The wizard form pre-populates these from whatever the school owner
// entered at signup (name) plus blanks, then PATCHes through this endpoint
// to advance to step 2.
//
// `motto` and `address` are nullable in the DB and stay optional here. An
// empty string from the form should be coerced to null before save — we do
// that at the service layer rather than in the schema so the schema stays
// a faithful description of the wire format, not of storage.
export const onboardingStep1Schema = z.object({
  name: z.string().trim().min(2).max(120),
  motto: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, "phone must be 10–15 digits, optionally prefixed with +"),
  email: z.string().trim().toLowerCase().email(),
});

export type OnboardingStep1Input = z.infer<typeof onboardingStep1Schema>;
