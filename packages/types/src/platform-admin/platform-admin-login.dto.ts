import { z } from "zod";

// POST /platform-admin/login — PUBLIC. Same leniency rationale as
// loginSchema (auth/login.dto.ts) and guardianLoginSchema
// (portal-auth/guardian-login.dto.ts): validating password complexity here
// would let an attacker probe policy compliance via 400-vs-401. Whatever
// the caller sends, a mismatch (wrong password, unknown email, or a real
// account that just isn't a platform admin) is the same generic
// INVALID_CREDENTIALS either way — see platform-admin.service.ts.
export const platformAdminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "password is required").max(128),
});

export type PlatformAdminLoginInput = z.infer<typeof platformAdminLoginSchema>;

export interface PlatformAdminLoginResponse {
  token: string;
}
