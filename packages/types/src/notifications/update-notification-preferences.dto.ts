import { z } from "zod";

// PUT /notification-preferences — both fields required (unlike guardian's
// PATCH-style partial update, this is a small fixed settings object; the
// admin UI always submits the full toggle state, not a partial diff).
// pushEnabled is deliberately absent — dark until the mobile phase (D3),
// not a knob this endpoint exposes.
export const updateNotificationPreferencesSchema = z
  .object({
    emailEnabled: z.boolean(),
    smsEnabled: z.boolean(),
  })
  .strict();

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
