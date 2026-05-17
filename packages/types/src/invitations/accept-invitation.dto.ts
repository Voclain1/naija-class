import { z } from "zod";

import type { SignupOwnerSchoolDto, SignupOwnerUserDto } from "../auth/signup-owner.dto.js";

// POST /invitations/:token/accept — PUBLIC endpoint.
//
// Password rules match signupOwnerSchema exactly. Duplicated here (rather
// than imported) because the constraints are short and the two schemas may
// drift independently as Phase 3 tightens signup password policy. If they
// diverge accidentally, the test plan will catch it — both have explicit
// unit-test coverage of the rule set.
//
// Email is NOT in the payload. The invitation row already pins the email;
// letting the invitee change it would mean a single token grants access
// under any address they pick, which is not what "invite to email X" means.
export const acceptInvitationSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    password: z
      .string()
      .min(8, "password must be at least 8 characters")
      .max(128, "password must be at most 128 characters")
      .regex(/[A-Za-z]/, "password must contain at least one letter")
      .regex(/[0-9]/, "password must contain at least one digit"),
    ndprConsent: z.literal(true, {
      errorMap: () => ({ message: "NDPR consent is required to accept an invitation" }),
    }),
  })
  .strict();

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

// Same shape as LoginResponse / SignupOwnerResponse. The accept flow is
// effectively "create user + log in" in one call, so the client treats the
// response identically — store the token, fetch /auth/me, redirect.
export interface AcceptInvitationResponse {
  user: SignupOwnerUserDto;
  school: SignupOwnerSchoolDto;
  token: string;
}
