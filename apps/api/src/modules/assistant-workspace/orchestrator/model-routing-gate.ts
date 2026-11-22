import { Injectable } from "@nestjs/common";
import { ASSISTANT_ORCHESTRATOR_APPROVAL } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import type { AssistantBlocker, AssistantCapabilitiesDto } from "@school-kit/types";

import { AiGenerationService } from "../../../common/ai/ai-generation.service.js";
import { readSchoolAiGovernance, type SchoolAiGovernance } from "../../../common/ai-release/ai-governance.js";
import { FeatureSwitchesService } from "../../../common/features/feature-switches.service.js";

/**
 * The CLAUDE.md allowlist approval (AO-1) for the `assistant-orchestrator`
 * prompt. Since 2026-11-22 it is no longer the runtime gate on its own: it is
 * the LIVE release's `live.allowlist-row` check (packages/ai release
 * requirements), so live children's data still cannot reach the model without
 * it, while a FICTIONAL pilot is governed by its own release. Reported to the
 * platform admin for visibility.
 */
export function orchestratorApproval(): { approval: "pending" | "approved" } {
  return { approval: ASSISTANT_ORCHESTRATOR_APPROVAL };
}

/**
 * Every reason model-backed understanding is not usable, most fundamental
 * first. Empty means usable. Pure, so the turn gate and the platform admin's
 * report cannot disagree about what blocks a school.
 */
export function modelRoutingBlockers(input: {
  switchOn: boolean;
  platformDisabled: boolean;
  releaseBlocking: boolean;
  termsBlocking: boolean;
  aiPlatformEnabled: boolean;
  providerConfigured: boolean;
  schoolAiEnabled: boolean;
}): AssistantBlocker[] {
  const out: AssistantBlocker[] = [];
  if (!input.switchOn) out.push("SWITCH_OFF");
  if (input.platformDisabled) out.push("PLATFORM_DISABLED");
  if (input.releaseBlocking) out.push("APPROVAL_PENDING");
  if (input.termsBlocking) out.push("TERMS_NOT_ACCEPTED");
  if (!input.aiPlatformEnabled) out.push("AI_PLATFORM_OFF");
  else if (!input.providerConfigured) out.push("AI_NOT_CONFIGURED");
  if (!input.schoolAiEnabled) out.push("SCHOOL_AI_OFF");
  return out;
}

/** The release and terms parts of the gate, from one governance read. */
export function governanceBlocking(g: SchoolAiGovernance): { releaseBlocking: boolean; termsBlocking: boolean } {
  return { releaseBlocking: g.enforced && !g.releaseAuthorised, termsBlocking: g.enforced && !g.termsAccepted };
}

/**
 * Whether the SchoolKit Assistant may send staff text to the model for this
 * school, now. Read on every capabilities call and again on every turn, with
 * no cache in between (docs/modules/assistant-ai-governance.md).
 *
 * All required:
 *   1. the release for the school's data scope (FICTIONAL or LIVE) is
 *      authorised and not revoked (enforced in production);
 *   2. the school's owner has accepted the current AI terms (enforced in
 *      production);
 *   3. the school's `assistant-model-routing` switch, set only by the platform
 *      admin, and no FEATURES_DISABLED kill;
 *   4. AI configured on this deployment, not switched off platform-wide, and
 *      on for the school.
 */
@Injectable()
export class ModelRoutingGate {
  constructor(private readonly ai: AiGenerationService, private readonly features: FeatureSwitchesService) {}

  async status(schoolId: string): Promise<AssistantCapabilitiesDto["modelRouting"]> {
    const governance = await readSchoolAiGovernance(schoolId);
    const { releaseBlocking, termsBlocking } = governanceBlocking(governance);
    if (releaseBlocking) return { available: false, reason: "NOT_APPROVED" };
    const key = "assistant-model-routing" as const;
    const platformDisabled = this.features.isPlatformDisabled(key);
    // The switch is read from the row now, not the 30-second cache: switching a
    // school off must stop its next turn.
    const switchOn = !platformDisabled && (await this.features.schoolSwitchesFresh(schoolId))[key];
    if (!switchOn) return { available: false, reason: "FEATURE_OFF" };
    if (termsBlocking) return { available: false, reason: "TERMS_NOT_ACCEPTED" };
    const { platformEnabled, providerConfigured } = this.ai.availability();
    const school = await withTenant(schoolId, (db) => db.school.findUnique({ where: { id: schoolId }, select: { aiEnabled: true } }));
    const blockers = modelRoutingBlockers({
      switchOn, platformDisabled, releaseBlocking: false, termsBlocking: false,
      aiPlatformEnabled: platformEnabled, providerConfigured, schoolAiEnabled: school?.aiEnabled === true,
    });
    return blockers.length === 0 ? { available: true, reason: null } : { available: false, reason: "AI_UNAVAILABLE" };
  }
}
