import { Injectable } from "@nestjs/common";
import { ASSISTANT_ORCHESTRATOR_APPROVAL } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import type { AssistantBlocker, AssistantCapabilitiesDto } from "@school-kit/types";

import { AiGenerationService } from "../../../common/ai/ai-generation.service.js";
import { FeatureSwitchesService } from "../../../common/features/feature-switches.service.js";

/**
 * The code half of the owner's approval of the `assistant-orchestrator`
 * prompt, and whether this deployment enforces it. Production always does.
 * ONE definition: the turn gate below, the platform admin's status report and
 * the refusal to switch a school on all read this.
 */
export function orchestratorApproval(): { approval: "pending" | "approved"; enforced: boolean; blocking: boolean } {
  const approval: "pending" | "approved" = ASSISTANT_ORCHESTRATOR_APPROVAL;
  const enforced = process.env.NODE_ENV === "production";
  return { approval, enforced, blocking: enforced && approval !== "approved" };
}

/**
 * Every reason model-backed understanding is not usable, most fundamental
 * first. Empty means usable. Pure, so the turn gate and the platform admin's
 * report cannot disagree about what blocks a school.
 */
export function modelRoutingBlockers(input: {
  switchOn: boolean;
  platformDisabled: boolean;
  approvalBlocking: boolean;
  aiPlatformEnabled: boolean;
  providerConfigured: boolean;
  schoolAiEnabled: boolean;
}): AssistantBlocker[] {
  const out: AssistantBlocker[] = [];
  if (!input.switchOn) out.push("SWITCH_OFF");
  if (input.platformDisabled) out.push("PLATFORM_DISABLED");
  if (input.approvalBlocking) out.push("APPROVAL_PENDING");
  if (!input.aiPlatformEnabled) out.push("AI_PLATFORM_OFF");
  else if (!input.providerConfigured) out.push("AI_NOT_CONFIGURED");
  if (!input.schoolAiEnabled) out.push("SCHOOL_AI_OFF");
  return out;
}

/**
 * Whether the SchoolKit Assistant may send staff text to the model for this
 * school, now. Read on every capabilities call and again on every turn.
 *
 * Four gates, all required:
 *   1. the prompt's own allowlist approval (ASSISTANT_ORCHESTRATOR_APPROVAL),
 *      enforced in production; pending today;
 *   2. the school's `assistant-model-routing` switch (off by default, and the
 *      FEATURES_DISABLED platform kill applies);
 *   3. AI configured on this deployment and not switched off platform-wide;
 *   4. AI switched on for the school.
 */
@Injectable()
export class ModelRoutingGate {
  constructor(private readonly ai: AiGenerationService, private readonly features: FeatureSwitchesService) {}

  async status(schoolId: string): Promise<AssistantCapabilitiesDto["modelRouting"]> {
    // Approval first, before any read: with it pending, production answers
    // the same for every school whatever its row says.
    const approval = orchestratorApproval();
    if (approval.blocking) return { available: false, reason: "NOT_APPROVED" };
    const key = "assistant-model-routing" as const;
    const platformDisabled = this.features.isPlatformDisabled(key);
    const switchOn = !platformDisabled && (await this.features.schoolSwitches(schoolId))[key];
    if (!switchOn) return { available: false, reason: "FEATURE_OFF" };
    const { platformEnabled, providerConfigured } = this.ai.availability();
    const school = await withTenant(schoolId, (db) => db.school.findUnique({ where: { id: schoolId }, select: { aiEnabled: true } }));
    const blockers = modelRoutingBlockers({
      switchOn, platformDisabled, approvalBlocking: false,
      aiPlatformEnabled: platformEnabled, providerConfigured, schoolAiEnabled: school?.aiEnabled === true,
    });
    return blockers.length === 0 ? { available: true, reason: null } : { available: false, reason: "AI_UNAVAILABLE" };
  }
}
