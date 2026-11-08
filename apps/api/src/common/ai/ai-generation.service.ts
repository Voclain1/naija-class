import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  PRICE_TABLE_VERSION,
  createAnthropicClient,
  estimateCostMicroUsd,
  estimateImageTokens,
  promptRef,
  type AiCallResult,
  type AiConversationMessage,
  type AiConversationResult,
  type AiImageInput,
  type AiToolCall,
  type AiToolDefinition,
  type AiToolResult,
  type AnthropicPort,
  type ModelId,
  type PromptDefinition,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { ForbiddenError, InternalError, RateLimitError } from "@school-kit/types";

import {
  AI_ERROR_CODES,
  DEFAULT_MONTHLY_TOKEN_BUDGET,
  DEFAULT_TURN_MAX_INPUT_TOKENS,
  DEFAULT_TURN_MAX_STEPS,
  DEFAULT_USER_DAILY_CALL_CAP,
  TOOL_USE_OVERHEAD_TOKENS,
  currentDayStart,
  currentPeriodStart,
} from "./ai.constants.js";

// ---------------------------------------------------------------------------
// AiGenerationService — the ONLY path from this application to Claude.
//
// It exists to make two CLAUDE.md AI hard rules mechanically true rather than
// conventionally true:
//   1. "Every call to claudeClient.messages.create must log to the
//       ai_generations table."
//   2. "Per-school monthly token budget enforced before the call, not after."
// A companion ESLint rule (packages/config/eslint/base.js) bans importing
// @anthropic-ai/sdk anywhere but packages/ai/src/client.ts, so bypassing this
// service is a CI failure rather than a code-review catch.
//
// ---------------------------------------------------------------------------
// THE TRANSACTION SHAPE IS LOAD-BEARING — RESERVE -> CALL -> SETTLE.
// (phase-5.md D1. Do not "simplify" this into one withTenant call.)
//
// withTenant opens a Prisma interactive transaction with a 5000ms default
// budget. The obvious shape —
//
//     withTenant(schoolId, async (db) => {
//       await checkBudget(db);
//       const res = await claude();      // 3-15 seconds
//       await db.aIGeneration.create();
//     })
//
// — is wrong for two independent reasons, and it was measured on the real
// production machine (2026-08-10) rather than assumed:
//
//   * It holds a Neon connection open for the entire generation, on
//     infrastructure where ~2s authenticated latency is already normal and
//     pooled connections have died under ordinary CRUD load before.
//
//   * It DOES NOT FAIL FAST. Prisma does not proactively abort at 5000ms; the
//     transaction is silently already closed and the NEXT statement inside it
//     throws. Measured: a 12s body threw P2028 after 12374ms — i.e. the naive
//     shape burns the full cost of the Anthropic call, then discards the
//     result AND writes no ledger row. That is a hard-rule violation (an
//     unlogged, paid-for call), not merely a reliability problem.
//
// So: two short transactions with the network call strictly between them.
//
// KNOWN, ACCEPTED FAILURE MODE: a process crash between reserve and settle
// leaks a reservation — the school's remaining budget is understated until the
// month rolls over. That is the correct direction to fail (closed, under-spend
// rather than over-spend), and building compensating-transaction machinery for
// six schools would be unjustified. It is bounded by the monthly period reset.
// ---------------------------------------------------------------------------

export interface GenerateParams {
  readonly schoolId: string;
  // Null for system/cron-driven calls (e.g. weekly parent summaries), which
  // have no acting user and are therefore exempt from the per-user daily cap.
  readonly userId?: string | null;
  readonly prompt: PromptDefinition;
  readonly system?: string;
  readonly userContent: string;
  // Optional link to the interaction/content record this call belongs to.
  // One conversation spans many rows here — see the AIGeneration model note.
  readonly interactionLogId?: string | null;
  // Optional structured-output schema, passed straight through to the port.
  // Callers that need a guaranteed response shape (the lesson-plan generator
  // writes five separate DB columns) supply one rather than parsing prose.
  readonly jsonSchema?: Record<string, unknown>;
  // Optional images, passed through to the port and priced into the
  // reservation. ONLY the prompt named in CLAUDE.md's PII-bearing prompt
  // allowlist may attach an image containing student PII — see that table
  // before adding a second caller.
  readonly images?: readonly AiImageInput[];
}

interface Reservation {
  readonly estimatedTokens: number;
  readonly periodStart: Date;
}

// What reserve() and settle() need to know about a call, whichever path makes
// it. GenerateParams satisfies it as it stands.
interface CallScope {
  readonly schoolId: string;
  readonly userId?: string | null;
  readonly prompt: PromptDefinition;
  readonly interactionLogId?: string | null;
}

// The usage settle() records: AiCallResult and AiConversationResult both carry it.
interface CallUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Conversation turns (FD-2b). One user turn = up to `maxSteps` model calls,
// each its own reserve -> call -> settle with its own ai_generations row, with
// tool calls executed between steps and NO transaction open across a call or a
// tool. See runConversationTurn().
// ---------------------------------------------------------------------------

export interface ConversationTurnParams extends CallScope {
  readonly system: string;
  /** The conversation so far, ending with the user's new message. User text and assistant TEXT only. */
  readonly history: readonly AiConversationMessage[];
  readonly tools: readonly AiToolDefinition[];
  /** Runs one tool call. Supplied by the tool registry (FD-3a), which checks permission and scope. */
  readonly executeTool: (call: AiToolCall) => Promise<AiToolResult>;
  readonly maxSteps?: number;
  readonly maxInputTokensPerTurn?: number;
}

export type TurnOutcome =
  | "answered"
  | "refused"
  | "truncated"
  | "step_limit"
  | "turn_token_limit"
  | "budget_exhausted"
  | "user_rate_limited"
  | "unexpected_stop";

export interface ConversationTurnResult {
  readonly outcome: TurnOutcome;
  /** The last assistant text of the turn ("" if none). */
  readonly text: string;
  /** Model calls made (each has exactly one ai_generations row). */
  readonly steps: number;
  /** Names of the tools called, in order. Names only: no inputs or outputs. */
  readonly toolCallNames: readonly string[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** The text a tool call gets when its executor throws. The thrown message never reaches the model. */
export const TOOL_FAILED_TEXT = "The tool failed. Answer without it, or say you could not check.";

// DI token for the Anthropic seam.
//
// Required because AnthropicPort is a TypeScript *interface*: it erases at
// runtime, so reflect-metadata reports the constructor parameter's type as
// `Object` and Nest tries — and fails — to resolve a provider for it
// ("Nest can't resolve dependencies of the AiGenerationService
// (ConfigService, ?)"). A plain `port?: AnthropicPort` parameter therefore
// makes the whole module unconstructable, even though direct `new`
// construction in specs works fine. Caught by the DI spec in this directory,
// which exists precisely because every other spec builds the service with
// `new` and so never exercises the container.
//
// Nothing provides this token in production: @Optional() leaves it undefined
// and the service builds the real client from ANTHROPIC_API_KEY. Tests either
// construct directly or override the token.
export const AI_PORT = Symbol("AI_PORT");

@Injectable()
export class AiGenerationService {
  private readonly logger = new Logger(AiGenerationService.name);
  private readonly port: AnthropicPort | null;
  private readonly platformEnabled: boolean;

  constructor(
    private readonly config: ConfigService,
    // Injectable so specs can supply a fake port. In production nothing
    // provides AI_PORT, so this is undefined and the real client is built
    // from ANTHROPIC_API_KEY. @Optional() + an explicit token are both
    // required — see the AI_PORT note above.
    @Optional() @Inject(AI_PORT) port?: AnthropicPort,
  ) {
    this.platformEnabled = (config.get<string>("AI_ENABLED") ?? "true").toLowerCase() !== "false";

    if (port) {
      this.port = port;
    } else {
      const key = config.get<string>("ANTHROPIC_API_KEY");
      // Fail-soft, per phase-5.md D11: a missing key makes AI features report
      // themselves disabled. It must NOT crash-loop the API — there is no
      // isolated staging environment, and a boot crash from a missing env var
      // has already taken production down once in this project.
      this.port = createAnthropicClient(key && !key.includes("placeholder") ? key : null);
      if (!this.port) {
        this.logger.warn(
          "ANTHROPIC_API_KEY is not configured — AI features will report themselves disabled (AI_NOT_CONFIGURED)",
        );
      }
    }
  }

  // True when a real call could be attempted. Feature modules should use this
  // to hide/disable AI affordances rather than letting a user click into an
  // error.
  isConfigured(): boolean {
    return this.platformEnabled && this.port !== null;
  }

  async generate(params: GenerateParams): Promise<AiCallResult> {
    if (!this.platformEnabled) {
      throw new ForbiddenError(AI_ERROR_CODES.DISABLED_PLATFORM, "AI features are disabled platform-wide.");
    }
    if (!this.port) {
      throw new ForbiddenError(AI_ERROR_CODES.NOT_CONFIGURED, "AI is not configured on this deployment.");
    }

    // ---- 1. RESERVE (short transaction, commits before the call) ----------
    // Pessimistic estimate: a rough input estimate plus the prompt's full
    // output ceiling. Over-reserving is the safe direction — settle reconciles
    // it down to the true count moments later.
    const estimatedTokens =
      estimateInputTokens(params.system, params.userContent, params.prompt.model, params.images) +
      params.prompt.maxTokens;
    const reservation = await this.reserve(params, estimatedTokens);

    // ---- 2. CALL (NO transaction open) ------------------------------------
    const startedAt = Date.now();
    let result: AiCallResult | null = null;
    let failure: unknown = null;
    try {
      result = await this.port.create({
        model: params.prompt.model,
        system: params.system,
        userContent: params.userContent,
        maxTokens: params.prompt.maxTokens,
        jsonSchema: params.jsonSchema,
        images: params.images,
      });
    } catch (e) {
      failure = e;
    }
    const latencyMs = Date.now() - startedAt;

    // ---- 3. SETTLE (short transaction; ALWAYS runs, success or failure) ---
    // A failed call must still release its reservation and still write a
    // ledger row, or a transient Anthropic outage would permanently consume a
    // school's budget and leave no record of why.
    await this.settle(params, reservation, result, failure, latencyMs);

    if (failure) {
      throw new InternalError("AI generation failed.", { promptRef: promptRef(params.prompt) });
    }
    return result as AiCallResult;
  }

  // -------------------------------------------------------------------------
  // CONVERSATION TURN (FD-2b)
  // -------------------------------------------------------------------------
  //
  // The single caller of AnthropicPort.converse(). Each step is the same
  // reserve -> call -> settle as generate(), so every model call has exactly one
  // ai_generations row and its budget is reserved before it is made.
  //
  // A step refused at reserve (budget or per-user cap) makes NO call and so
  // writes NO row (owner's decision 2026-11-07, plan §4.3): the turn ends with
  // an outcome instead of an error. Earlier steps keep their rows.
  //
  // Opaque assistant turns live only in `messages` below and never leave this
  // method. Nothing about the conversation's content is logged.
  async runConversationTurn(params: ConversationTurnParams): Promise<ConversationTurnResult> {
    if (!this.platformEnabled) {
      throw new ForbiddenError(AI_ERROR_CODES.DISABLED_PLATFORM, "AI features are disabled platform-wide.");
    }
    if (!this.port) {
      throw new ForbiddenError(AI_ERROR_CODES.NOT_CONFIGURED, "AI is not configured on this deployment.");
    }
    const converse = this.port.converse?.bind(this.port);
    if (!converse) {
      throw new ForbiddenError(AI_ERROR_CODES.NOT_CONFIGURED, "AI conversations are not available on this deployment.");
    }

    // History is TEXT only: user messages and earlier assistant replies. An
    // opaque turn belongs to the loop that made it and is never carried into a
    // later request; tool results only ever follow a turn made in this loop.
    if (params.history.length === 0 || params.history[params.history.length - 1]!.role !== "user") {
      throw new InternalError("A conversation turn needs history ending with the user's message.");
    }
    if (params.history.some((m) => !("text" in m))) {
      throw new InternalError("Conversation history must be text only (no assistant turns or tool results).");
    }

    const maxSteps = params.maxSteps ?? DEFAULT_TURN_MAX_STEPS;
    const maxInput = params.maxInputTokensPerTurn ?? DEFAULT_TURN_MAX_INPUT_TOKENS;
    const messages: AiConversationMessage[] = [...params.history];
    const toolCallNames: string[] = [];
    let steps = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let text = "";
    let previous: AiConversationResult | null = null;
    let pendingResultChars = 0;

    const done = (outcome: TurnOutcome): ConversationTurnResult => {
      this.logger.log(
        `AI turn ${outcome}: school=${params.schoolId} prompt=${promptRef(params.prompt)} steps=${steps} ` +
          `tools=${toolCallNames.length} in=${inputTokens} out=${outputTokens}`,
      );
      return { outcome, text, steps, toolCallNames, inputTokens, outputTokens };
    };

    for (;;) {
      // Step input estimate (must err high; opaque turns hide their content).
      const estimatedInput =
        previous === null
          ? estimateConversationInput(params.system, params.history, params.tools)
          : previous.inputTokens + previous.outputTokens + Math.ceil(pendingResultChars / 4) + 16;
      if (inputTokens + estimatedInput > maxInput) return done("turn_token_limit");

      let reservation: Reservation;
      try {
        reservation = await this.reserve(params, estimatedInput + params.prompt.maxTokens);
      } catch (e) {
        if (e instanceof RateLimitError && e.code === AI_ERROR_CODES.BUDGET_EXCEEDED) return done("budget_exhausted");
        if (e instanceof RateLimitError && e.code === AI_ERROR_CODES.USER_RATE_LIMITED) return done("user_rate_limited");
        throw e;
      }

      const startedAt = Date.now();
      let result: AiConversationResult | null = null;
      let failure: unknown = null;
      try {
        result = await converse({
          model: params.prompt.model,
          system: params.system,
          maxTokens: params.prompt.maxTokens,
          messages,
          tools: params.tools,
        });
      } catch (e) {
        failure = e;
      }
      await this.settle(params, reservation, result, failure, Date.now() - startedAt, "code");
      steps += 1;

      if (failure || !result) {
        throw new InternalError("AI generation failed.", { promptRef: promptRef(params.prompt) });
      }
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      text = result.text;
      previous = result;

      switch (result.stopReason) {
        case "end_turn":
          return done("answered");
        case "refusal":
          return done("refused");
        case "max_tokens":
          return done("truncated");
        case "tool_use":
          break;
        default:
          return done("unexpected_stop");
      }

      if (result.toolCalls.length === 0) return done("unexpected_stop");
      if (steps >= maxSteps) return done("step_limit");

      // Run the calls in order. No transaction is open here; each tool owns its
      // own tenant-scoped reads (FD-3a). A throwing tool becomes an error result
      // with fixed text: its message is not sent to the model or logged.
      const results: AiToolResult[] = [];
      for (const call of result.toolCalls) {
        toolCallNames.push(call.name);
        try {
          results.push(await params.executeTool(call));
        } catch (e) {
          this.logger.warn(
            `AI tool failed: school=${params.schoolId} tool=${call.name} error=${e instanceof Error ? e.name : "unknown"}`,
          );
          results.push({ toolUseId: call.id, content: TOOL_FAILED_TEXT, isError: true });
        }
      }
      pendingResultChars = results.reduce((sum, r) => sum + r.content.length, 0);
      messages.push({ role: "assistant", turn: result.assistantTurn });
      messages.push({ role: "user", toolResults: results });
    }
  }

  // -------------------------------------------------------------------------
  // RESERVE
  // -------------------------------------------------------------------------
  private async reserve(params: CallScope, estimatedTokens: number): Promise<Reservation> {
    const periodStart = currentPeriodStart();
    const dayStart = currentDayStart();

    return withTenant(params.schoolId, async (db) => {
      const school = await db.school.findUnique({
        where: { id: params.schoolId },
        select: { aiEnabled: true, aiMonthlyTokenBudget: true },
      });
      if (!school) {
        throw new InternalError("AI generation: school not found.");
      }
      if (!school.aiEnabled) {
        throw new ForbiddenError(AI_ERROR_CODES.DISABLED_SCHOOL, "AI features are disabled for this school.");
      }

      // Per-user daily call cap. Counts settled rows only, which means a burst
      // of in-flight calls can slightly overshoot — acceptable, because this
      // is a guard against runaway loops, not an accounting boundary.
      if (params.userId) {
        const callsToday = await db.aIGeneration.count({
          where: { schoolId: params.schoolId, userId: params.userId, createdAt: { gte: dayStart } },
        });
        if (callsToday >= DEFAULT_USER_DAILY_CALL_CAP) {
          throw new RateLimitError(
            AI_ERROR_CODES.USER_RATE_LIMITED,
            `Daily AI limit reached (${DEFAULT_USER_DAILY_CALL_CAP} requests). Try again tomorrow.`,
          );
        }
      }

      const budget = school.aiMonthlyTokenBudget ?? DEFAULT_MONTHLY_TOKEN_BUDGET;

      // Ensure the period row exists. ON CONFLICT DO NOTHING makes the
      // first-call-of-the-month race harmless: concurrent callers both try,
      // one wins, both proceed to the UPDATE below.
      await db.$executeRaw`
        INSERT INTO ai_budget_periods (id, school_id, period_start, updated_at)
        VALUES (${crypto.randomUUID()}, ${params.schoolId}, ${periodStart}::date, NOW())
        ON CONFLICT (school_id, period_start) DO NOTHING
      `;

      // THE ENFORCEMENT STATEMENT. One conditional atomic UPDATE, not a
      // read-then-write: Postgres row-level locking serializes concurrent
      // callers on this single row, so there is no window in which two calls
      // both observe "under budget" and both proceed. Zero rows affected means
      // the reservation would breach the cap — i.e. over budget.
      const affected = await db.$executeRaw`
        UPDATE ai_budget_periods
           SET tokens_reserved = tokens_reserved + ${estimatedTokens},
               call_count      = call_count + 1,
               updated_at      = NOW()
         WHERE school_id    = ${params.schoolId}
           AND period_start = ${periodStart}::date
           AND tokens_reserved + ${estimatedTokens} <= ${budget}
      `;

      if (affected === 0) {
        throw new RateLimitError(
          AI_ERROR_CODES.BUDGET_EXCEEDED,
          "This school has reached its monthly AI usage limit.",
        );
      }

      return { estimatedTokens, periodStart };
    });
  }

  // -------------------------------------------------------------------------
  // SETTLE
  // -------------------------------------------------------------------------
  private async settle(
    params: CallScope,
    reservation: Reservation,
    result: CallUsage | null,
    failure: unknown,
    latencyMs: number,
    // "message" keeps generate()'s existing redacted message. "code" (conversation
    // steps) records the error's class name only: a conversation carries text a
    // user typed, so nothing that could echo it is stored (plan §3.6).
    errorStyle: "message" | "code" = "message",
  ): Promise<void> {
    const inputTokens = result?.inputTokens ?? 0;
    const outputTokens = result?.outputTokens ?? 0;
    const actualTokens = inputTokens + outputTokens;

    // A refusal is a completed, billable call — real token counts, but not a
    // usable result. Recorded as success=false so it is not mistaken for a
    // working generation when the ledger is read back.
    const refused = result?.stopReason === "refusal";
    const success = result !== null && !refused;

    try {
      await withTenant(params.schoolId, async (db) => {
        await db.aIGeneration.create({
          data: {
            schoolId: params.schoolId,
            userId: params.userId ?? null,
            interactionLogId: params.interactionLogId ?? null,
            model: params.prompt.model,
            promptName: params.prompt.name,
            promptVersion: params.prompt.version,
            inputTokens,
            outputTokens,
            latencyMs,
            costMicroUsd: estimateCostMicroUsd(params.prompt.model, inputTokens, outputTokens),
            pricedAtVersion: PRICE_TABLE_VERSION,
            success,
            errorMessage:
              errorStyle === "code" ? buildErrorCode(failure, refused) : buildErrorMessage(failure, refused),
          },
        });

        // Reconcile: remove the pessimistic reservation, add the truth.
        // On the failure path actualTokens is 0, so this releases the whole
        // reservation — no permanent budget hole from a failed call.
        //
        // Deliberately NOT wrapped in GREATEST(0, ...). This subtraction can
        // only go negative if settle runs twice for a single reserve, or if
        // the period row was reset underneath us — both are bugs, and clamping
        // them to zero would silently corrupt a school's spend figure instead
        // of surfacing the defect. The non-negativity CHECK constraints added
        // in slice 2's migration turn that case into a loud error, which the
        // catch below logs. A clamp here would make those constraints dead
        // code, which is why it was removed when they landed.
        await db.$executeRaw`
          UPDATE ai_budget_periods
             SET tokens_reserved = tokens_reserved - ${reservation.estimatedTokens} + ${actualTokens},
                 tokens_actual   = tokens_actual + ${actualTokens},
                 cost_micro_usd  = cost_micro_usd + ${estimateCostMicroUsd(params.prompt.model, inputTokens, outputTokens)},
                 updated_at      = NOW()
           WHERE school_id    = ${params.schoolId}
             AND period_start = ${reservation.periodStart}::date
        `;
      });
    } catch (e) {
      // Settle failing is the documented leak window. Log loudly — the
      // reservation stays until the period rolls over, so a recurring warning
      // here means real budget is being silently consumed.
      this.logger.error(
        `AI settle failed for school ${params.schoolId} (${promptRef(params.prompt)}); ` +
          `${reservation.estimatedTokens} reserved tokens will remain held until the period resets`,
        e instanceof Error ? e.stack : undefined,
      );
    }
  }
}

// Rough token estimate for the reservation only — never used for billing or
// for the ledger, both of which use the API's reported counts. ~4 chars per
// token is the conventional English approximation; deliberately rounded UP so
// the reservation errs high.
// IMAGES ARE COUNTED SEPARATELY AND MUST BE (smart-student-import §2). An
// image contributes zero characters, so the chars/4 approximation prices a
// 4784-visual-token register photo at nothing. Left uncounted, a school
// sitting just under its cap could fire a scan the reservation thinks costs
// ~4,200 tokens and that actually costs ~10,400 — settle() would reconcile
// the ledger to the truth afterwards, but the budget would already have been
// overshot, and CLAUDE.md's rule is "enforced BEFORE the call, not after".
// That makes this a hard-rule regression rather than an imprecision, which is
// why the model id is a parameter here: visual-token caps are per-model.
export function estimateInputTokens(
  system: string | undefined,
  userContent: string,
  model?: ModelId,
  images?: readonly AiImageInput[],
): number {
  const chars = (system?.length ?? 0) + userContent.length;
  const textTokens = Math.ceil(chars / 4) + 16;

  if (!images || images.length === 0) return textTokens;
  if (!model) {
    // Unreachable through generate(), which always passes the prompt's model.
    // Throwing rather than silently returning the text-only estimate: a
    // caller that attached images and lost the model has hit the exact bug
    // this parameter exists to prevent, and swallowing it would restore the
    // under-reservation quietly.
    throw new InternalError("estimateInputTokens: images supplied without a model to price them.");
  }

  const imageTokens = images.reduce(
    (sum, image) => sum + estimateImageTokens(model, image.widthPx, image.heightPx),
    0,
  );
  return textTokens + imageTokens;
}

// First-step input estimate for a conversation: system + history text + tool
// schemas at ~4 chars per token, plus the API's tool-use overhead when tools are
// offered. Rounded up; settle() reconciles to the real count.
export function estimateConversationInput(
  system: string,
  history: readonly AiConversationMessage[],
  tools: readonly AiToolDefinition[],
): number {
  let chars = system.length;
  for (const m of history) {
    if ("text" in m) chars += m.text.length; // history is text only (checked by the caller)
  }
  chars += tools.reduce((sum, t) => sum + t.name.length + t.description.length + JSON.stringify(t.inputSchema).length, 0);
  return Math.ceil(chars / 4) + 16 + (tools.length > 0 ? TOOL_USE_OVERHEAD_TOKENS : 0);
}

// Conversation steps record a code, never a message: a conversation carries
// text a user typed, and a provider error can echo request content.
function buildErrorCode(failure: unknown, refused: boolean): string | null {
  if (refused) return "stop_reason=refusal";
  if (!failure) return null;
  return failure instanceof Error ? failure.name : "UnknownError";
}

// Redacted, per CLAUDE.md: never put secrets, PII, or a raw prompt echo in an
// error field. Only the error's class name and a short message survive, and
// the message is truncated in case a provider ever echoes request content back
// inside it.
function buildErrorMessage(failure: unknown, refused: boolean): string | null {
  if (refused) return "stop_reason=refusal";
  if (!failure) return null;
  if (failure instanceof Error) return `${failure.name}: ${failure.message}`.slice(0, 300);
  return "Unknown error";
}
