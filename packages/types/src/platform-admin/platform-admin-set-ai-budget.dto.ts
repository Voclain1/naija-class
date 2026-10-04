import { z } from "zod";

// PATCH /platform-admin/schools/:schoolId/ai-budget — sets the per-school
// monthly AI cap (School.aiMonthlyTokenBudget), in TOKENS. `null` clears it,
// so the school falls back to the platform default.
//
// Until this existed, capping a school meant a raw production UPDATE with a
// hand-written audit row (docs/deferred.md, 2026-08-16). The monthly budget is
// the only real spend bound on the AI bill — the per-user daily call cap is a
// runaway-loop guard, not a spend guard — so changing it is an audited click.
//
// The upper bound is a typo guard, not a policy: 1 billion tokens a month is
// far beyond any school, and well inside Postgres INTEGER.
export const PLATFORM_ADMIN_AI_BUDGET_MAX = 1_000_000_000;

export const platformAdminSetAiBudgetSchema = z.object({
  aiMonthlyTokenBudget: z.number().int().min(0).max(PLATFORM_ADMIN_AI_BUDGET_MAX).nullable(),
});

export type PlatformAdminSetAiBudgetInput = z.infer<typeof platformAdminSetAiBudgetSchema>;

export interface PlatformAdminSetAiBudgetResponse {
  schoolId: string;
  aiMonthlyTokenBudget: number | null;
  aiEffectiveMonthlyTokenBudget: number;
}
