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
export const onboardingStep2Schema = z.object({
  primaryColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_RE, "primaryColor must be a 6-digit hex colour, e.g. #1A2B3C")
    .optional(),
});

export type OnboardingStep2Input = z.infer<typeof onboardingStep2Schema>;
