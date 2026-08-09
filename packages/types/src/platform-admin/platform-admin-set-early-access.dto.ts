import { z } from "zod";

// PATCH /platform-admin/schools/:schoolId/early-access — toggles the
// early-access marker on a school.
//
// A boolean in, a timestamp stored: `true` stamps now(), `false` clears to
// null. The API deliberately does NOT accept a caller-supplied timestamp —
// backdating "when we promised this school free access" is exactly the kind
// of unverifiable claim an audit trail exists to prevent, and there is no
// real use case for it (the audit_logs row records who flipped it and when).
//
// This endpoint sets a MARKER ONLY. Nothing in the platform reads
// earlyAccessGrantedAt to make any decision — there is no plan, tier, or
// subscription concept in the product yet. See docs/deferred.md "Pricing /
// tier enforcement" for the decisions this is deliberately not making.
export const platformAdminSetEarlyAccessSchema = z.object({
  earlyAccess: z.boolean(),
});

export type PlatformAdminSetEarlyAccessInput = z.infer<
  typeof platformAdminSetEarlyAccessSchema
>;

export interface PlatformAdminSetEarlyAccessResponse {
  schoolId: string;
  earlyAccessGrantedAt: string | null;
}
