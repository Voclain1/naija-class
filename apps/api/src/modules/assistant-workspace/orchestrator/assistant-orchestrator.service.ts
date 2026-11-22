import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { ASSISTANT_ORCHESTRATOR_PROMPT, ASSISTANT_ORCHESTRATOR_SYSTEM, searchGuide, type AiConversationMessage, type AiToolCall, type AiToolResult } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { ForbiddenError, type AssistantTurnDto, type AssistantTurnInput, type AssistantTurnOutcome } from "@school-kit/types";

import { AiGenerationService, type TurnOutcome } from "../../../common/ai/ai-generation.service.js";
import { WITHHELD, loadProviderEgressGuard } from "../../../common/ai/pii/provider-egress-guard.js";
import { PersonRefs, checkConversation, loadQuestionRoster, redactRosterNames, withholdRosterNames } from "../../../common/ai/pii/question-check.js";
import type { AuthContext } from "../../../common/auth/auth-context.js";
import { BillingRunsService } from "../../invoices/billing-runs.service.js";
import { ReminderCampaignsService } from "../../reminder-campaigns/reminder-campaigns.service.js";
import { StudentCorrectionsService } from "../../student-corrections/student-corrections.service.js";
import { StudentIntakeService } from "../../student-intake/student-intake.service.js";
import { AssistantWorkspaceService } from "../assistant-workspace.service.js";
import { StudentLookupService } from "../student-lookup.service.js";
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
    private readonly lookup: StudentLookupService,
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
      findStudents: (auth, query) => lookup.find(auth, query, "conversation"),
      permissions: (auth) => loadPermissions(auth),
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

    // Every message the browser resent is checked again, every turn. Names on
    // the school's roster are first REPLACED by opaque markers (⟨P1⟩), by the
    // detector's own rules, so a name never reaches the model and never blocks
    // the task; the markers' names stay on the server for this request only.
    // Any other detector hit (contacts, ID numbers, dates, pasted rows,
    // admission numbers) still means NOTHING goes to the model.
    const roster = await loadQuestionRoster(auth.schoolId);
    const persons = new PersonRefs();
    // Second line, by VALUE not pattern (provider-egress-guard.ts): a full
    // name the school holds becomes a marker too, in any case or order; any
    // other identifier the school holds (admission number, email, phone) that
    // survived the detectors blocks the turn.
    const egress = await loadProviderEgressGuard(auth.schoolId);
    const messages = input.messages.map((m) => ({ ...m, text: egress.markNames(redactRosterNames(m.text, roster, persons), persons) }));
    const check = checkConversation(messages.map((m) => m.text), roster);
    const heldIdentifiers = new Set(messages.flatMap((m) => egress.scan(m.text)));
    if (check.blocked || heldIdentifiers.size > 0) {
      // The pattern detectors' categories when they caught it; "known-identifier"
      // only for what they missed and the value match caught.
      const categories = check.blocked ? [...check.categories] : ["known-identifier"];
      return { outcome: "blocked", reply: "", actions: [], blockedCategories: categories, toolsUsed: [] };
    }

    // Students found earlier, re-checked now against tenant, role and scope:
    // another school's id, or one outside a teacher's classes, is dropped.
    const known = await this.lookup.describe(auth, input.students.map((st) => st.studentId));
    const students = input.students.flatMap((st) => {
      const d = known.get(st.studentId);
      return d ? [{ handle: st.handle, studentId: st.studentId, selected: st.selected, classLabel: d.classLabel }] : [];
    });
    const state = new TurnState(await this.deps.structure(auth), input.tasks, students, persons.values);
    const registry = orchestratorToolRegistry(this.deps, state).forTurn(auth);
    const deadline = Date.now() + TURN_DEADLINE_MS;
    let withheld = 0;
    const executeTool = async (call: AiToolCall): Promise<AiToolResult> => {
      if (Date.now() > deadline) return { toolUseId: call.id, content: "Time limit reached. Stop and tell the person to try again.", isError: true };
      const result = await registry.executeTool(call);
      // Tool results are labels and counts by design; school-typed labels can
      // still carry a name or contact. Nothing the school holds leaves here.
      const byValue = egress.redact(result.content);
      const byRoster = withholdRosterNames(byValue.text, roster, WITHHELD);
      withheld += byValue.withheld + byRoster.withheld;
      return { ...result, content: byRoster.text };
    };

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
        history: modelHistory({ ...input, messages }, state.summary()).map((m): AiConversationMessage => {
          // The whole outgoing history, task summary included, passes the guard last.
          const text = egress.redact(m.text).text;
          return m.role === "user" ? { role: "user", text } : { role: "assistant", text };
        }),
        tools: registry.tools,
        executeTool,
        maxSteps: TURN_MAX_STEPS,
        maxInputTokensPerTurn: TURN_MAX_INPUT_TOKENS,
      });
      if (withheld > 0) this.logger.warn(`Assistant turn withheld identifiers from tool results: school=${auth.schoolId} count=${withheld}`);
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

/** The caller's current permissions (the same read PermissionsGuard makes). */
async function loadPermissions(auth: AuthContext): Promise<Set<string>> {
  return withTenant(auth.schoolId, async (db) => {
    const grants = await db.userRole.findMany({ where: { userId: auth.userId }, select: { role: { select: { permissions: true } } } });
    return new Set(grants.flatMap((g) => (Array.isArray(g.role.permissions) ? (g.role.permissions as unknown[]) : []).filter((p): p is string => typeof p === "string")));
  });
}
