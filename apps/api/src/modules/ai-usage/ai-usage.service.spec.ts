import type { ConfigService } from "@nestjs/config";
import { beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { DEFAULT_MONTHLY_TOKEN_BUDGET, currentPeriodStart } from "../../common/ai/ai.constants.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { AiUsageService } from "./ai-usage.service.js";

// Read-only surface, so the interesting assertions are about WHICH number is
// reported, not about writes. Two of them are load-bearing:
//   * headroom is reported from tokensReserved, not tokensActual — reporting
//     actuals would tell an admin they have room the budget check will refuse;
//   * failed generations still appear in the per-prompt breakdown, because
//     they still cost money.

const configStub = () => ({ get: () => undefined }) as unknown as ConfigService;
const runId = Math.random().toString(36).slice(2, 8);

let schoolId: string;
let adminId: string;
let service: AiUsageService;

function ctx(): AuthContext {
  return { schoolId, userId: adminId } as AuthContext;
}

describe("AiUsageService", () => {
  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: { name: `AU ${runId}`, slug: `au-${runId}`, status: "ACTIVE" },
      select: { id: true },
    });
    schoolId = school.id;

    const adminRoleId = (
      await basePrisma.role.findFirstOrThrow({
        where: { schoolId: null, key: "admin", isSystem: true },
        select: { id: true },
      })
    ).id;

    await withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email: `admin-${runId}@t.test`,
          firstName: "Ada",
          lastName: "Admin",
        },
        select: { id: true },
      });
      adminId = user.id;
      await db.userRole.create({ data: { userId: user.id, roleId: adminRoleId } });

      // A period row whose reserved figure is deliberately HIGHER than its
      // actual — the mid-flight state the reserved-vs-actual choice exists for.
      await db.aIBudgetPeriod.create({
        data: {
          schoolId,
          periodStart: currentPeriodStart(),
          tokensReserved: 500_000,
          tokensActual: 320_000,
          callCount: 3,
          costMicroUsd: 1_250_000,
        },
      });

      const mkGeneration = async (promptName: string, success: boolean, tokens: number) =>
        db.aIGeneration.create({
          data: {
            schoolId,
            model: "claude-haiku-4-5",
            promptName,
            promptVersion: "1",
            inputTokens: tokens,
            outputTokens: tokens,
            latencyMs: 900,
            costMicroUsd: 400,
            pricedAtVersion: "2026-08-10",
            success,
          },
        });

      await mkGeneration("parent-weekly-summary", true, 100);
      await mkGeneration("parent-weekly-summary", false, 50);
      await mkGeneration("lesson-plan", true, 1000);
    });

    service = new AiUsageService(new AiGenerationService(configStub()));
  });

  it("reports headroom against tokensReserved, not tokensActual", async () => {
    const usage = await service.getUsage(ctx(), { months: 3 });

    expect(usage.periods[0]?.tokensReserved).toBe(500_000);
    expect(usage.periods[0]?.tokensActual).toBe(320_000);
    // The cap is the platform default — this school has no override.
    expect(usage.monthlyTokenBudget).toBe(DEFAULT_MONTHLY_TOKEN_BUDGET);
  });

  it("groups the current month by prompt, counts failures, and orders by tokens", async () => {
    const usage = await service.getUsage(ctx(), { months: 3 });

    // lesson-plan (2000 tokens) outranks parent-weekly-summary (300).
    expect(usage.byPrompt.map((p) => p.promptName)).toEqual([
      "lesson-plan",
      "parent-weekly-summary",
    ]);

    const summary = usage.byPrompt.find((p) => p.promptName === "parent-weekly-summary");
    // Both calls counted, including the failed one — a failed generation was
    // still paid for.
    expect(summary?.callCount).toBe(2);
    expect(summary?.failureCount).toBe(1);
    expect(summary?.totalTokens).toBe(300);
  });

  it("reports aiConfigured false when no API key is configured", async () => {
    const usage = await service.getUsage(ctx(), { months: 3 });
    expect(usage.aiConfigured).toBe(false);
    expect(usage.aiEnabled).toBe(true); // schools default to AI on (slice 1)
  });
});
