import { z } from "zod";

// POST /platform-admin/schools — the first write on this surface. Only a
// name + the owner's email are collected; everything else (address, phone,
// logo, branding, NDPR consent) is filled in by the owner themselves via the
// existing onboarding wizard once they accept, same as a self-serve signup.
// See CLAUDE.md's "Platform super-admin" note for the full plan-first
// writeup, including why this deliberately does NOT collect a slug (server-
// derived from schoolName) or the owner's name (collected at accept time,
// same as any other Invitation).
export const platformAdminCreateSchoolSchema = z.object({
  schoolName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email(),
});

export type PlatformAdminCreateSchoolInput = z.infer<typeof platformAdminCreateSchoolSchema>;

// acceptUrl is always returned, regardless of whether the invite email send
// succeeded — same "never hide the fallback" posture as
// GuardiansService.invite()'s response. It's the operator's manual-copy
// fallback if Resend delivery fails or the operator wants to share the link
// directly.
export interface PlatformAdminCreateSchoolResponse {
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  ownerEmail: string;
  invitationExpiresAt: string;
  acceptUrl: string;
}
