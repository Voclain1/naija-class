import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  PRICE_TABLE_VERSION,
  createAnthropicClient,
  estimateCostMicroUsd,
  promptRef,
  type AiCallResult,
  type AnthropicPort,
  type PromptDefinition,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { ForbiddenError, InternalError, RateLimitError } from "@school-kit/types";

import {
  AI_ERROR_CODES,
  DEFAULT_MONTHLY_TOKEN_BUDGET,
  DEFAULT_USER_DAILY_CALL_CAP,
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
}

interface Reservation {
  readonly estimatedTokens: number;
  readonly periodStart: Date;
}

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
    const reservation = await this.reserve(params);

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
  // RESERVE
  // -------------------------------------------------------------------------
  private async reserve(params: GenerateParams): Promise<Reservation> {
    const periodStart = currentPeriodStart();
    const dayStart = currentDayStart();

    // Pessimistic estimate: a rough input estimate plus the prompt's full
    // output ceiling. Over-reserving is the safe direction — settle reconciles
    // it down to the true count moments later.
    const estimatedInput = estimateInputTokens(params.system, params.userContent);
    const estimatedTokens = estimatedInput + params.prompt.maxTokens;

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
    params: GenerateParams,
    reservation: Reservation,
    result: AiCallResult | null,
    failure: unknown,
    latencyMs: number,
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
            errorMessage: buildErrorMessage(failure, refused),
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
export function estimateInputTokens(system: string | undefined, userContent: string): number {
  const chars = (system?.length ?? 0) + userContent.length;
  return Math.ceil(chars / 4) + 16;
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
