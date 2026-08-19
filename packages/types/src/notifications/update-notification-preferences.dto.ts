import { z } from "zod";

// PUT /notification-preferences — both fields required (unlike guardian's
// PATCH-style partial update, this is a small fixed settings object; the
// admin UI always submits the full toggle state, not a partial diff).
// pushEnabled joined this endpoint in Phase 6 / Slice 5. It was absent
// because push was "dark until the mobile phase (D3)" — that phase has now
// arrived, and until it was settable no school could ever reach the push
// branch in NotificationDispatchService, so D37's saving was unreachable by
// construction rather than merely unused.
//
// Like smsEnabled it defaults OFF in the schema and stays a deliberate
// opt-in: push costs a school nothing, but it puts notifications on parents'
// lockscreens, and that is the school's decision to make rather than ours to
// assume because it is free.
export const updateNotificationPreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
    pushEnabled: z.boolean(),
  })
  .strict();

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
