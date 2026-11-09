import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ASSISTANT_ORCHESTRATOR_PROMPT, ASSISTANT_ORCHESTRATOR_SYSTEM, searchGuide, type AiConversationMessage, type AiToolCall, type AiToolResult } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { ForbiddenError, type AssistantTurnDto, type AssistantTurnInput, type AssistantTurnOutcome } from "@school-kit/types";

import { AiGenerationService, type TurnOutcome } from "../../../common/ai/ai-generation.service.js";
import { checkConversation, loadQuestionRoster } from "../../../common/ai/pii/question-check.js";
import type { AuthContext } from "../../../common/auth/auth-context.js";
import { BillingRunsService } from "../../invoices/billing-runs.service.js";
import { ReminderCampaignsService } from "../../reminder-campaigns/reminder-campaigns.service.js";
import { StudentCorrectionsService } from "../../student-corrections/student-corrections.service.js";
import { StudentIntakeService } from "../../student-intake/student-intake.service.js";
import { AssistantWorkspaceService } from "../assistant-workspace.service.js";
import { orchestratorToolRegistry, TurnState, type OrchestratorDeps } from "./orchestrator-tools.js";
import { checkReply, type SchoolStructure } from "./resolve.js";

// ---------------------------------------------------------------------------
// One model-backed SchoolKit Assistant turn (docs/modules/assistant-workspace.md,
// "Model orchestration"): request → detectors → bounded, budgeted tool loop →
// checked reply and code-built actions. The browser applies the actions to its
// cards; approval stays the card's own control on the server's preview.
//
// HOLDS NOTHING. The conversation arrives in the request and leaves in the
// response: no question, reply or tool content is stored, queued, cached or
// logged here. Logs carry the school, the outcome and tool NAMES only (the
// loop's own log line), never text.
// ---------------------------------------------------------------------------

/** No tool runs after this; the model is told to stop. */
export const TURN_DEADLINE_MS = 45_000;
export const TURN_MAX_STEPS = 6;
export const TURN_MAX_INPUT_TOKENS = 24_000;

const FALLBACK: Record<AssistantTurnOutcome, string> = {
  answered: "Done. Check the card below.",
  blocked: "",
  budget_exhausted: "Your school's AI allowance for this month is used up. You can still use the task buttons below.",
  rate_limited: "You've reached today's limit for AI requests. You can still use the task buttons below.",
  incomplete: "I couldn't finish that. Nothing was approved or changed; any card below shows only what the server prepared. Try a shorter request.",
  refused: "I can't help with that request.",
  unavailable: "AI understanding isn't available for your school right now. You can still use the task buttons below.",
};

const OUTCOMES: Record<TurnOutcome, AssistantTurnOutcome> = {
  answered: "answered",
  refused: "refused",
  truncated: "incomplete",
  step_limit: "incomplete",
  turn_token_limit: "incomplete",
  unexpected_stop: "incomplete",
  budget_exhausted: "budget_exhausted",
  user_rate_limited: "rate_limited",
};

@Injectable()
export class AssistantOrchestratorService {
  private readonly logger = new Logger(AssistantOrchestratorService.name);
  readonly deps: OrchestratorDeps;

  constructor(
    private readonly ai: AiGenerationService,
    private readonly workspace: AssistantWorkspaceService,
    billing: BillingRunsService,
    campaigns: ReminderCampaignsService,
    intake: StudentIntakeService,
    corrections: StudentCorrectionsService,
  ) {
    this.deps = {
      structure: (auth) => loadStructure(auth),
      capabilities: (auth) => this.workspace.capabilities(auth),
      // PREPARE only: the PENDING preview. Approval is BillingRunsService.approve, called by the person's card.
      prepareInvoices: (auth, scope) => billing.prepare(auth, scope, null),
      invoiceRun: (auth, id) => billing.get(auth, id),
      campaign: (auth, id) => campaigns.getCampaign(auth, id),
      reminderProposalCampaignId: async (auth, id) => (await campaigns.getProposal(auth, id)).campaignId,
      intakeProposal: (auth, id) => intake.get(auth, id),
      correctionProposal: (auth, id) => corrections.get(auth, id),
      recentCampaignIds: (auth) =>
        withTenant(auth.schoolId, async (db) =>
          (await db.reminderCampaign.findMany({
            where: { schoolId: auth.schoolId, requestedBy: auth.userId },
            orderBy: { createdAt: "desc" },
            take: 3,
            select: { id: true },
          })).map((c) => c.id),
        ),
      searchGuide: (question) =>
        searchGuide(question, { limit: 3, maxExcerptChars: 600 }).map((h) => ({ anchor: h.anchor, title: h.title, path: h.path, excerpt: h.excerpt })),
    };
  }

  async turn(auth: AuthContext, input: AssistantTurnInput): Promise<AssistantTurnDto> {
    const result = (outcome: AssistantTurnOutcome, reply = "", extra: Partial<AssistantTurnDto> = {}): AssistantTurnDto => ({
      outcome, reply: reply || FALLBACK[outcome], actions: [], blockedCategories: [], toolsUsed: [], ...extra,
    });

    // The person, now: active, grants, switches, and the model gate.
    const caps = await this.workspace.capabilities(auth);
    if (!caps.enabled || !caps.modelRouting.available) return result("unavailable");

    // Every message the browser resent is checked again, every turn. A hit
    // means NOTHING goes to the model; the categories go back, never the text.
    const roster = await loadQuestionRoster(auth.schoolId);
    const check = checkConversation(input.messages.map((m) => m.text), roster);
    if (check.blocked) return { outcome: "blocked", reply: "", actions: [], blockedCategories: [...check.categories], toolsUsed: [] };

    const state = new TurnState(await this.deps.structure(auth), input.tasks);
    const registry = orchestratorToolRegistry(this.deps, state).forTurn(auth);
    const deadline = Date.now() + TURN_DEADLINE_MS;
    const executeTool = (call: AiToolCall): Promise<AiToolResult> =>
      Date.now() > deadline
        ? Promise.resolve({ toolUseId: call.id, content: "Time limit reached. Stop and tell the person to try again.", isError: true })
        : registry.executeTool(call);

    // An interaction record with no content, so each model call's ledger row
    // groups under this turn.
    const interaction = await withTenant(auth.schoolId, (db) =>
      db.aIInteractionLog.create({
        data: { schoolId: auth.schoolId, sessionRef: randomUUID(), payload: { feature: "assistant-orchestration" } },
        select: { id: true },
      }),
    );

    try {
      const turn = await this.ai.runConversationTurn({
        schoolId: auth.schoolId,
        userId: auth.userId,
        interactionLogId: interaction.id,
        prompt: ASSISTANT_ORCHESTRATOR_PROMPT,
        system: ASSISTANT_ORCHESTRATOR_SYSTEM,
        history: modelHistory(input, state.summary()).map((m): AiConversationMessage => (m.role === "user" ? { role: "user", text: m.text } : { role: "assistant", text: m.text })),
        tools: registry.tools,
        executeTool,
        maxSteps: TURN_MAX_STEPS,
        maxInputTokensPerTurn: TURN_MAX_INPUT_TOKENS,
      });
      const outcome = OUTCOMES[turn.outcome];
      const reply = outcome === "answered" ? checkReply(turn.text) : "";
      return result(outcome, reply, { actions: state.actions, toolsUsed: [...turn.toolCallNames] });
    } catch (e) {
      if (e instanceof ForbiddenError) return result("unavailable");
      // Name only: a model or tool error message never reaches a log.
      this.logger.warn(`Assistant turn failed: school=${auth.schoolId} error=${e instanceof Error ? e.name : "unknown"}`);
      return result("incomplete", "", { actions: state.actions });
    }
  }
}

/**
 * The browser's conversation as the model sees it: alternating text turns
 * starting with the person, with the task summary appended to the newest
 * message. Earlier assistant replies are the model's own text.
 */
export function modelHistory(input: AssistantTurnInput, summary: string): { role: "user" | "assistant"; text: string }[] {
  const merged: { role: "user" | "assistant"; text: string }[] = [];
  for (const m of input.messages) {
    if (merged.length === 0 && m.role === "assistant") continue;
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.text = `${last.text}\n\n${m.text}`;
    else merged.push({ role: m.role, text: m.text });
  }
  const newest = merged[merged.length - 1]!;
  newest.text = `${newest.text}\n\n${summary}`;
  return merged;
}

async function loadStructure(auth: AuthContext): Promise<SchoolStructure> {
  return withTenant(auth.schoolId, async (db) => {
    const [terms, arms] = await Promise.all([
      db.term.findMany({ where: { schoolId: auth.schoolId }, include: { academicYear: true }, orderBy: [{ startDate: "asc" }, { sequence: "asc" }] }),
      db.classArm.findMany({ where: { schoolId: auth.schoolId, isActive: true }, include: { classLevel: true }, orderBy: { name: "asc" } }),
    ]);
    return {
      terms: terms.map((t) => ({ id: t.id, name: t.name, year: t.academicYear.label, academicYearId: t.academicYearId, sequence: t.sequence, isCurrent: t.isCurrent, startDate: t.startDate })),
      arms: arms.map((a) => ({ id: a.id, name: a.name, level: a.classLevel.name })),
    };
  });
}
