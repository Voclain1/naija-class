import type { AssistantWorkflow } from "../assistant/index.js";
import type { FeatureKey } from "../feature-switches/index.js";

// GET /platform-admin/schools/:schoolId/assistant (2026-11-10,
// docs/modules/assistant-workspace.md, "Controlled activation").
//
// What the platform admin sees before and after flipping a SchoolKit Assistant
// switch for one school: each switch as STORED, whether the thing it gates is
// actually WORKING for that school now, and every reason it is not. A switch
// that is on is never reported as working while anything still blocks it.
//
// Operator-facing status about the tenancy only: no staff, student or usage
// detail beyond the month's token totals the AI budget control already shows.

/** Why something whose switch may be on is still not working. Ordered: the first is the one to fix first. */
export const ASSISTANT_BLOCKERS = [
  // The school's own switch for this item is off.
  "SWITCH_OFF",
  // FEATURES_DISABLED on the API names this key (or "*"): off for every school.
  "PLATFORM_DISABLED",
  // The Assistant panel itself is off (or platform-disabled) for the school, so nothing can reach this item.
  "WORKSPACE_OFF",
  // AI understanding only: the release for the school's data scope (FICTIONAL or LIVE) is not authorised, or was revoked.
  "APPROVAL_PENDING",
  // AI understanding only: the school's owner has not accepted the current AI terms.
  "TERMS_NOT_ACCEPTED",
  // AI understanding only: AI is switched off for the whole platform (AI_ENABLED=false).
  "AI_PLATFORM_OFF",
  // AI understanding only: no AI provider key is configured on this deployment.
  "AI_NOT_CONFIGURED",
  // AI understanding only: AI is off for this school.
  "SCHOOL_AI_OFF",
  // AI understanding only: the school has used its AI token budget for the month.
  "BUDGET_EXHAUSTED",
] as const;
export type AssistantBlocker = (typeof ASSISTANT_BLOCKERS)[number];

/** The exact words the console shows for each blocker. */
export const ASSISTANT_BLOCKER_TEXT: Record<AssistantBlocker, string> = {
  SWITCH_OFF: "Its switch is off for this school.",
  PLATFORM_DISABLED: "Switched off for every school on the server (FEATURES_DISABLED).",
  WORKSPACE_OFF: "The Assistant panel is not working for this school, so staff cannot reach it.",
  APPROVAL_PENDING:
    "The AI release for this school's data scope (fictional or live) is not authorised, or was revoked. Production refuses AI understanding until it is.",
  TERMS_NOT_ACCEPTED: "The school's owner has not accepted the current SchoolKit Assistant AI terms.",
  AI_PLATFORM_OFF: "AI is switched off for the whole platform (AI_ENABLED).",
  AI_NOT_CONFIGURED: "No AI provider key is configured on the server.",
  SCHOOL_AI_OFF: "AI is off for this school.",
  BUDGET_EXHAUSTED: "This school has used its AI token budget for the month.",
};

export interface AssistantActivationItemDto {
  key: FeatureKey;
  /** The school's stored switch, read from the row now (not the 30-second cache). */
  switchOn: boolean;
  /** True only when nothing blocks it: staff with the right permissions can use it now. */
  working: boolean;
  /** Every reason it is not working, most fundamental first. Empty exactly when `working`. */
  blockers: AssistantBlocker[];
}

export interface PlatformAdminAssistantStatusDto {
  schoolId: string;
  /** The Assistant panel in the staff app. */
  workspace: AssistantActivationItemDto;
  /** The four reviewed tasks the panel prepares. Each also needs the person's own permissions. */
  workflows: Record<AssistantWorkflow, AssistantActivationItemDto>;
  /** Model-backed understanding of typed requests. Without it the panel still works, by buttons and fixed phrases. */
  aiUnderstanding: AssistantActivationItemDto & {
    /**
     * Since 2026-11-22: whether the AI release for this school's data scope is
     * authorised ("approved") or not ("pending"); see
     * docs/modules/assistant-ai-governance.md.
     */
    approval: "pending" | "approved";
    /** Whether this deployment enforces the release and terms gates (production does). */
    approvalEnforced: boolean;
    /** LIVE (real records) or FICTIONAL (a pilot tenant of invented records). Set by the platform admin. */
    dataClassification: "LIVE" | "FICTIONAL";
    /** The school owner's acceptance of the current AI terms. */
    termsAccepted: boolean;
    /** CLAUDE.md's allowlist approval of the prompt (AO-1): required by the LIVE release only. */
    allowlistApproval: "pending" | "approved";
  };
  ai: {
    platformEnabled: boolean;
    providerConfigured: boolean;
    schoolEnabled: boolean;
    monthlyTokenBudget: number;
    tokensUsedThisMonth: number;
  };
  /** Another API process may serve the old value of a switch for up to this long after a change. */
  switchCacheSeconds: number;
}
