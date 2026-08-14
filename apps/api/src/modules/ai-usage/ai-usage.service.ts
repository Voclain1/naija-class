import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type { AiUsageByPromptDto, AiUsageDto, AiUsagePeriodDto, GetAiUsageInput } from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { DEFAULT_MONTHLY_TOKEN_BUDGET, currentPeriodStart } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// ---------------------------------------------------------------------------
// AiUsageService — the read side of the slice-1 cost ledger.
//
// `ai-usage.read` has existed as a permission since slice 1 and had no
// endpoint behind it until now, so a school running four AI features has had
// no way to see spend or headroom. This closes that.
//
// READS BOTH TABLES, FOR DIFFERENT QUESTIONS, and the split is the same one
// slice 1 drew (D4):
//   * ai_budget_periods answers "how close to the cap are we" — it is the
//     counter the budget check actually enforces against, so it is the only
//     honest source for that question.
//   * ai_generations answers "what is using it" — a per-call ledger, grouped
//     here by prompt. This is an aggregate over a growing table, which D4
//     rejected for the ENFORCEMENT path; it is fine here because this runs on
//     an admin opening a page, not on the hot path of every AI call.
//
// tokensReserved is what gets shown against the cap, not tokensActual. Mid-
// flight reservations are real headroom the school cannot use, and showing
// actuals would tell an admin they have room the budget check will refuse.
// ---------------------------------------------------------------------------
@Injectable()
export class AiUsageService {
  constructor(private readonly ai: AiGenerationService) {}

  async getUsage(authCtx: AuthContext, input: GetAiUsageInput): Promise<AiUsageDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const thisPeriod = currentPeriodStart();
    // First day of the month `months - 1` back, so the window always starts on
    // a period boundary and lines up with the rows in ai_budget_periods.
    const from = new Date(
      Date.UTC(thisPeriod.getUTCFullYear(), thisPeriod.getUTCMonth() - (input.months - 1), 1),
    );

    return withTenant(authCtx.schoolId, async (db) => {
      const [school, periodRows, generationRows] = await Promise.all([
        db.school.findUnique({
          where: { id: authCtx.schoolId },
          select: { aiEnabled: true, aiMonthlyTokenBudget: true },
        }),
        db.aIBudgetPeriod.findMany({
          where: { periodStart: { gte: from } },
          select: {
            periodStart: true,
            tokensReserved: true,
            tokensActual: true,
            callCount: true,
            costMicroUsd: true,
          },
          orderBy: { periodStart: "desc" },
        }),
        // Current month only — see the DTO's note. A per-prompt breakdown over
        // a year of history is a different (and much heavier) question nobody
        // has asked for.
        db.aIGeneration.findMany({
          where: { createdAt: { gte: thisPeriod } },
          select: {
            promptName: true,
            inputTokens: true,
            outputTokens: true,
            costMicroUsd: true,
            success: true,
          },
        }),
      ]);

      const periods: AiUsagePeriodDto[] = periodRows.map((p) => ({
        periodStart: p.periodStart,
        tokensReserved: p.tokensReserved,
        tokensActual: p.tokensActual,
        callCount: p.callCount,
        costMicroUsd: p.costMicroUsd,
      }));

      // Grouped in memory rather than with groupBy: three sums and a
      // conditional count over one month of one school's rows is a small set,
      // and a single findMany keeps the failure-count logic readable instead
      // of splitting it across two aggregate queries.
      const byPromptMap = new Map<string, AiUsageByPromptDto>();
      for (const g of generationRows) {
        const existing = byPromptMap.get(g.promptName) ?? {
          promptName: g.promptName,
          callCount: 0,
          totalTokens: 0,
          costMicroUsd: 0,
          failureCount: 0,
        };
        existing.callCount += 1;
        existing.totalTokens += g.inputTokens + g.outputTokens;
        existing.costMicroUsd += g.costMicroUsd;
        if (!g.success) existing.failureCount += 1;
        byPromptMap.set(g.promptName, existing);
      }

      const byPrompt = [...byPromptMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);

      return {
        monthlyTokenBudget: school?.aiMonthlyTokenBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET,
        aiEnabled: school?.aiEnabled ?? false,
        aiConfigured: this.ai.isConfigured(),
        periods,
        byPrompt,
      };
    });
  }
}
