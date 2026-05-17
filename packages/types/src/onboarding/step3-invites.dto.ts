import { z } from "zod";

// Step 3 — Invite admins. Zero invites is valid (the wizard offers a "Skip
// for now" affordance). Cap of 20 per call is arbitrary but prevents an
// over-eager paste of a CSV column from creating hundreds of invitation
// rows in one click; the spec covers small private schools, so 20 admins
// per setup pass is plenty.
//
// Duplicate-email detection runs in superRefine because Zod's per-field
// schema can't see siblings — we want one error that points at the second
// occurrence rather than a generic "invalid array".
//
// Domain validation, invite-cannot-target-existing-user, etc. happen at
// accept time (Slice 7), not here. Slice 6 only creates Invitation rows.
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
});

// `invites` is required (no .default()) — the frontend always sends an
// array, using [] for "Skip for now". Two reasons: (1) Zod 3's
// .default([]).superRefine() pipeline confuses z.infer into making the
// field optional in the inferred output type, which then mismatches the
// discriminated-union payload we hand to the service; (2) an explicit
// empty array reads more clearly in audit metadata than "field absent".
export const onboardingStep3Schema = z.object({
  invites: z
    .array(inviteSchema)
    .max(20, "at most 20 invitations per submission")
    .superRefine((invites, ctx) => {
      const seen = new Set<string>();
      invites.forEach((invite, index) => {
        if (seen.has(invite.email)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "email"],
            message: "duplicate email in payload",
          });
        }
        seen.add(invite.email);
      });
    }),
});

export type OnboardingStep3Input = z.infer<typeof onboardingStep3Schema>;
export type OnboardingInviteInput = z.infer<typeof inviteSchema>;
