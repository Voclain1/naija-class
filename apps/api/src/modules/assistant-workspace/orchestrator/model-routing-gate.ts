import { Injectable } from "@nestjs/common";
import { ASSISTANT_ORCHESTRATOR_APPROVAL } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import type { AssistantCapabilitiesDto } from "@school-kit/types";

import { AiGenerationService } from "../../../common/ai/ai-generation.service.js";
import { FeatureSwitchesService } from "../../../common/features/feature-switches.service.js";

/**
 * Whether the SchoolKit Assistant may send staff text to the model for this
 * school, now. Read on every capabilities call and again on every turn.
 *
 * Four gates, all required:
 *   1. the prompt's own allowlist approval (ASSISTANT_ORCHESTRATOR_APPROVAL),
 *      enforced in production; pending today;
 *   2. the school's `assistant-model-routing` switch (off by default, and the
 *      FEATURES_DISABLED platform kill applies through isOn);
 *   3. AI configured on this deployment and not switched off platform-wide;
 *   4. AI switched on for the school.
 */
@Injectable()
export class ModelRoutingGate {
  constructor(private readonly ai: AiGenerationService, private readonly features: FeatureSwitchesService) {}

  async status(schoolId: string): Promise<AssistantCapabilitiesDto["modelRouting"]> {
    if (ASSISTANT_ORCHESTRATOR_APPROVAL !== "approved" && process.env.NODE_ENV === "production") {
      return { available: false, reason: "NOT_APPROVED" };
    }
    if (!(await this.features.isOn(schoolId, "assistant-model-routing"))) return { available: false, reason: "FEATURE_OFF" };
    if (!this.ai.isConfigured()) return { available: false, reason: "AI_UNAVAILABLE" };
    const school = await withTenant(schoolId, (db) => db.school.findUnique({ where: { id: schoolId }, select: { aiEnabled: true } }));
    if (!school?.aiEnabled) return { available: false, reason: "AI_UNAVAILABLE" };
    return { available: true, reason: null };
  }
}
