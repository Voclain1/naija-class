import { ASSISTANT_VOICE_APPROVAL } from "@school-kit/ai";
import type { VoiceBlocker } from "@school-kit/types";

/**
 * Legacy approval metadata for operator visibility. Super Admin's per-school
 * feature switch is the activation control; this metadata does not block
 * production sessions. Provider, workspace, routing, tenancy and budget
 * checks continue to fail closed independently.
 */
export function voiceApproval(env: NodeJS.ProcessEnv = process.env): { approval: "pending" | "approved"; enforced: boolean; blocking: boolean } {
  const approval: "pending" | "approved" = ASSISTANT_VOICE_APPROVAL;
  const enforced = false;
  return { approval, enforced, blocking: enforced && approval !== "approved" };
}

export interface VoiceGateInput {
  switchOn: boolean;
  workspaceWorking: boolean;
  modelRoutingWorking: boolean;
  approvalBlocking: boolean;
  providerConfigured: boolean;
  voiceSecondsRemaining: number;
  minSessionSeconds: number;
  aiBudgetExhausted: boolean;
}

/**
 * Every reason voice is not usable, in VOICE_BLOCKERS order. Pure, so the
 * request path and the operator's report cannot disagree.
 */
export function voiceBlockers(i: VoiceGateInput): VoiceBlocker[] {
  const out: VoiceBlocker[] = [];
  if (!i.switchOn) out.push("SWITCH_OFF");
  if (!i.workspaceWorking) out.push("WORKSPACE_OFF");
  if (!i.modelRoutingWorking) out.push("MODEL_ROUTING_UNAVAILABLE");
  if (i.approvalBlocking) out.push("APPROVAL_PENDING");
  if (!i.providerConfigured) out.push("PROVIDER_NOT_CONFIGURED");
  if (i.voiceSecondsRemaining < i.minSessionSeconds) out.push("VOICE_BUDGET_EXHAUSTED");
  if (i.aiBudgetExhausted) out.push("AI_BUDGET_EXHAUSTED");
  return out;
}

/**
 * Blockers that end a session already running (a revocation). Budget blockers
 * do not: a running session's seconds were reserved when it started, and the
 * model turn refuses on its own when the AI allowance runs out.
 */
export const REVOKING_BLOCKERS: ReadonlySet<VoiceBlocker> = new Set([
  "SWITCH_OFF",
  "WORKSPACE_OFF",
  "MODEL_ROUTING_UNAVAILABLE",
  "APPROVAL_PENDING",
  "PROVIDER_NOT_CONFIGURED",
]);

export const BUDGET_BLOCKERS: ReadonlySet<VoiceBlocker> = new Set(["VOICE_BUDGET_EXHAUSTED", "AI_BUDGET_EXHAUSTED"]);
