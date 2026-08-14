import { z } from "zod";

// PATCH /platform-admin/schools/:schoolId/ai — turns the per-school AI kill
// switch (School.aiEnabled) on or off.
//
// WHY THIS EXISTS. There are two independent AI gates: the platform-wide
// AI_ENABLED env var, and this per-school boolean. Until 2026-08-14 only the
// env var was doing any work, because School.aiEnabled is `@default(true)` —
// so flipping AI_ENABLED to "true" would have enabled AI for every school in
// the database simultaneously. packages/db/scripts/disable-ai-per-school.ts
// closes that gate on the existing population; this endpoint is how a school
// gets it opened again, deliberately, one at a time. Without it, enabling a
// pilot school means a hand-written UPDATE against production with no audit
// row — exactly what this surface's other writes exist to avoid.
//
// Shape mirrors platformAdminSetEarlyAccessSchema: a plain boolean in, the
// resulting state out. Unlike that one there is no timestamp translation —
// aiEnabled is stored as the boolean it is, so `true` in means `true`
// stored, and the endpoint is genuinely idempotent (re-enabling an already-
// enabled school changes nothing and re-stamps nothing).
//
// UNLIKE early access, this flag is NOT inert: it is read on the hot path by
// AiGenerationService.reserve(), which throws AI_ERROR_CODES.DISABLED_SCHOOL
// when it is false, and by ParentSummariesService. Setting it false stops
// every AI feature for that school within one request, no deploy required —
// that is the point of it being a kill switch. Setting it true does NOT by
// itself start anything while AI_ENABLED is "false" platform-wide.
export const platformAdminSetAiEnabledSchema = z.object({
  aiEnabled: z.boolean(),
});

export type PlatformAdminSetAiEnabledInput = z.infer<
  typeof platformAdminSetAiEnabledSchema
>;

export interface PlatformAdminSetAiEnabledResponse {
  schoolId: string;
  aiEnabled: boolean;
}
