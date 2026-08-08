import { z } from "zod";

// Six-digit hex colour. Lowercase or uppercase both fine; the # is required
// (mirrors how the value will be consumed in CSS — applying it via Phase 2
// theming wants the value to be a complete CSS colour, not a fragment).
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// Step 2 — Branding. primaryColor is optional: a school that hasn't decided
// on a colour can submit an empty payload and still advance to step 3.
//
// logoUrl deliberately does NOT appear here (resolved 2026-07-26, closing a
// gap docs/deferred.md now tracks in full). It previously accepted a raw
// external URL string — meaning "upload a logo" required a school owner to
// already know how to host an image somewhere else first, which is both bad
// UX and the real reason school logos were essentially never set by anyone.
// The Phase 0 spec (docs/modules/phase-0.md) always named this as "logo
// upload (to R2)" — the ONE file-upload feature Phase 0 was meant to ship —
// but the shipped code silently substituted a URL text field instead, and
// that substitution was never logged anywhere as a scope change. Logo is now
// upload-only via `POST /schools/me/logo` (multipart, real R2/filesystem
// storage — see schools.service.ts), the same "not PATCH-able as plain text"
// treatment Expense.receiptUrl already gets. Do not re-add a logoUrl string
// field to this schema — that would silently reopen the exact gap this note
// describes.
// `.optional()` only rescues a genuinely absent field — an empty string
// still reaches `.regex()` first and fails it, since Zod validates chained
// checks in order before `.optional()` gets a say. A blank "Continue with
// nothing filled in" submit sends `primaryColor: ""`, not an absent key, so
// without the preprocess below this "optional" field was not actually
// skippable (docs/deferred.md's step-2 branding entry). Preprocessing ""
// to undefined here fixes both the frontend zodResolver gate and the
// PATCH /schools/me validation (patch-school.dto.ts merges this schema) in
// one place — same fix class as the student-form.tsx resolution, applied at
// the schema instead of the call site since this schema is shared.
export const onboardingStep2Schema = z.object({
  primaryColor: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .trim()
      .regex(HEX_COLOR_RE, "primaryColor must be a 6-digit hex colour, e.g. #1A2B3C")
      .optional(),
  ),
});

export type OnboardingStep2Input = z.infer<typeof onboardingStep2Schema>;

// The preprocess above makes this schema's Input genuinely differ from its
// Output (Input allows the raw `""` a text field submits; Output is always
// a valid hex string or undefined) — react-hook-form's zodResolver needs
// the FORM's field-values type to match Input, not Output, or its generic
// inference breaks (see step2-branding-form.tsx's useForm<> call, which
// uses this type for TFieldValues and OnboardingStep2Input for
// TTransformedValues).
export type OnboardingStep2FormInput = z.input<typeof onboardingStep2Schema>;
