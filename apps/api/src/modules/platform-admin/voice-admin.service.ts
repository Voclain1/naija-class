import { Inject, Injectable, Optional } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import { NotFoundError, parseFeatureSwitches, type PlatformAdminVoiceStatusDto } from "@school-kit/types";

import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { voiceApproval, voiceBlockers } from "../assistant-voice/voice-gate";
import { VoiceLedger } from "../assistant-voice/voice-ledger";
import { VOICE_PROVIDER, type VoiceProviderPort } from "../assistant-voice/voice-provider.port";
import { AssistantActivationService } from "./assistant-activation.service";

// The platform admin's view of SchoolKit Assistant voice for ONE school
// (docs/modules/assistant-voice.md, "Operator controls"). Read-only.
//
// Same rule as the Assistant's own report: whether the switch is ON and
// whether voice is WORKING are separate answers, and every blocker is named.
// The blockers come from voiceBlockers(), the function the request path uses,
// fed with the Assistant report's own answers for the panel and the model,
// so this cannot drift from what staff get.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class VoiceAdminService {
  constructor(
    private readonly features: FeatureSwitchesService,
    private readonly assistant: AssistantActivationService,
    private readonly ledger: VoiceLedger,
    @Optional() @Inject(VOICE_PROVIDER) private readonly provider: VoiceProviderPort | null = null,
  ) {}

  async status(schoolId: string): Promise<PlatformAdminVoiceStatusDto> {
    if (!UUID.test(schoolId)) throw new NotFoundError("School not found.");
    const assistant = await this.assistant.status(schoolId); // throws NotFound for an unknown school
    const read = await withTenant(schoolId, async (db) => {
      await this.ledger.sweep(db, schoolId);
      const school = await db.school.findUnique({ where: { id: schoolId }, select: { featureSwitches: true, voiceMonthlySecondsBudget: true } });
      return {
        school,
        usage: await this.ledger.monthUsage(db, schoolId),
        aiExhausted: await this.ledger.aiBudgetExhausted(db, schoolId),
      };
    });
    if (!read.school) throw new NotFoundError("School not found.");

    const switchOn = parseFeatureSwitches(read.school.featureSwitches)["assistant-voice"];
    const approval = voiceApproval();
    const blockers = voiceBlockers({
      switchOn: switchOn && !this.features.isPlatformDisabled("assistant-voice"),
      workspaceWorking: assistant.workspace.working,
      modelRoutingWorking: assistant.aiUnderstanding.working,
      approvalBlocking: approval.blocking,
      providerConfigured: this.provider !== null,
      voiceSecondsRemaining: read.usage.remainingSeconds,
      minSessionSeconds: this.ledger.config.minSessionSeconds,
      aiBudgetExhausted: read.aiExhausted,
    });
    return {
      schoolId,
      switchOn,
      working: blockers.length === 0,
      blockers,
      approval: approval.approval,
      approvalEnforced: approval.enforced,
      provider: this.ledger.config.provider,
      providerConfigured: this.provider !== null,
      monthlySecondsBudget: read.school.voiceMonthlySecondsBudget,
      effectiveMonthlySecondsBudget: read.usage.budgetSeconds,
      defaultMonthlySecondsBudget: this.ledger.config.defaultMonthlySeconds,
      secondsUsedThisMonth: read.usage.usedSeconds,
      sessionsThisMonth: read.usage.sessions,
      activeSessions: read.usage.activeSessions,
      estimatedCostMicroUsdThisMonth: read.usage.estimatedCostMicroUsd,
      limits: this.ledger.limits(),
    };
  }
}
