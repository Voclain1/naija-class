import { Injectable } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import {
  ASSISTANT_WORKFLOWS,
  NotFoundError,
  parseFeatureSwitches,
  type AssistantActivationItemDto,
  type AssistantBlocker,
  type AssistantWorkflow,
  type FeatureKey,
  type PlatformAdminAssistantStatusDto,
} from "@school-kit/types";

import { AiGenerationService } from "../../common/ai/ai-generation.service";
import { DEFAULT_MONTHLY_TOKEN_BUDGET, currentPeriodStart } from "../../common/ai/ai.constants";
import { FEATURE_SWITCH_CACHE_TTL_MS, FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { modelRoutingBlockers, orchestratorApproval } from "../assistant-workspace/orchestrator/model-routing-gate";

// The platform admin's view of the SchoolKit Assistant for ONE school
// (docs/modules/assistant-workspace.md, "Controlled activation").
//
// Read-only. For each switch it answers two different questions and never
// merges them: is the switch ON (the stored row, read now, not the cache),
// and is the thing WORKING (nothing else blocks it). Every blocker is named,
// so a switch that is on can never read as "AI enabled" while the approval
// gate, the provider key, the school's AI switch or its budget still stops it.
//
// The blockers come from the same functions the request path uses
// (modelRoutingBlockers, orchestratorApproval, isPlatformDisabled), so this
// report cannot drift from what staff actually get. What it cannot see is one
// person's permissions: "working" means working for staff who hold them.

export const WORKFLOW_FEATURE: Record<AssistantWorkflow, FeatureKey> = {
  invoices: "assistant-billing",
  reminders: "reminder-campaigns",
  intake: "student-intake",
  corrections: "student-corrections",
};

@Injectable()
export class AssistantActivationService {
  constructor(private readonly features: FeatureSwitchesService, private readonly ai: AiGenerationService) {}

  async status(schoolId: string): Promise<PlatformAdminAssistantStatusDto> {
    // withTenant needs a UUID; anything else cannot be a school.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(schoolId)) throw new NotFoundError("School not found.");
    const periodStart = currentPeriodStart();
    const read = await withTenant(schoolId, async (db) => {
      const school = await db.school.findUnique({
        where: { id: schoolId },
        select: { featureSwitches: true, aiEnabled: true, aiMonthlyTokenBudget: true },
      });
      if (!school) return null;
      const period = await db.aIBudgetPeriod.findUnique({
        where: { schoolId_periodStart: { schoolId, periodStart } },
        select: { tokensReserved: true },
      });
      return { school, used: period?.tokensReserved ?? 0 };
    });
    if (!read) throw new NotFoundError("School not found.");

    const stored = parseFeatureSwitches(read.school.featureSwitches);
    const item = (key: FeatureKey, extra: AssistantBlocker[] = []): AssistantActivationItemDto => {
      const blockers: AssistantBlocker[] = [];
      if (!stored[key]) blockers.push("SWITCH_OFF");
      if (this.features.isPlatformDisabled(key)) blockers.push("PLATFORM_DISABLED");
      for (const b of extra) if (!blockers.includes(b)) blockers.push(b);
      return { key, switchOn: stored[key], working: blockers.length === 0, blockers };
    };

    const workspace = item("assistant-workspace");
    const behindPanel: AssistantBlocker[] = workspace.working ? [] : ["WORKSPACE_OFF"];
    const workflows = Object.fromEntries(
      ASSISTANT_WORKFLOWS.map((w) => [w, item(WORKFLOW_FEATURE[w], behindPanel)]),
    ) as Record<AssistantWorkflow, AssistantActivationItemDto>;

    const approval = orchestratorApproval();
    const { platformEnabled, providerConfigured } = this.ai.availability();
    const budget = read.school.aiMonthlyTokenBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET;
    const routingKey = "assistant-model-routing" as const;
    const routing = modelRoutingBlockers({
      switchOn: stored[routingKey],
      platformDisabled: this.features.isPlatformDisabled(routingKey),
      approvalBlocking: approval.blocking,
      aiPlatformEnabled: platformEnabled,
      providerConfigured,
      schoolAiEnabled: read.school.aiEnabled,
    });
    // In ASSISTANT_BLOCKERS order: the panel right after the switch itself.
    const aiBlockers: AssistantBlocker[] = [
      ...routing.filter((b) => b === "SWITCH_OFF" || b === "PLATFORM_DISABLED"),
      ...behindPanel,
      ...routing.filter((b) => b !== "SWITCH_OFF" && b !== "PLATFORM_DISABLED"),
      ...(read.used >= budget ? (["BUDGET_EXHAUSTED"] as const) : []),
    ];

    return {
      schoolId,
      workspace,
      workflows,
      aiUnderstanding: {
        key: routingKey,
        switchOn: stored[routingKey],
        working: aiBlockers.length === 0,
        blockers: aiBlockers,
        approval: approval.approval,
        approvalEnforced: approval.enforced,
      },
      ai: {
        platformEnabled,
        providerConfigured,
        schoolEnabled: read.school.aiEnabled,
        monthlyTokenBudget: budget,
        tokensUsedThisMonth: read.used,
      },
      switchCacheSeconds: FEATURE_SWITCH_CACHE_TTL_MS / 1000,
    };
  }
}
