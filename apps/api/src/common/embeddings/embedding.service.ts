import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODELS,
  EMBEDDING_PRICE_TABLE_VERSION,
  createVoyageClient,
  estimateEmbeddingCostMicroUsd,
  type EmbeddingInputType,
  type EmbeddingModelId,
  type EmbeddingPort,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import { ForbiddenError } from "@school-kit/types";

import { currentPeriodStart } from "../ai/ai.constants.js";

// ---------------------------------------------------------------------------
// EmbeddingService — the ONLY path from this application to the embedding
// vendor. Sibling of AiGenerationService, deliberately NOT the same class.
//
// Why not reuse AiGenerationService (docs/modules/phase-7.md D3): its
// GenerateParams requires a PromptDefinition, and its ai_generations row
// requires promptName, promptVersion and outputTokens. None of those exist for
// an embedding call. Forcing them would mean writing fiction into the one
// table in this system that must not contain any.
//
// WHAT THIS SHARES with AiGenerationService, on purpose:
//   * fail-soft on a missing key — the feature reports itself unavailable, it
//     never crash-loops the API (phase-5.md D11; a missing env var has taken
//     this production down once already)
//   * an injectable port, so ledger and fail-soft behaviour are testable
//     without a live key
//   * one ledger row per call, success or failure
//
// WHAT IT DELIBERATELY DOES NOT SHARE:
//   * the reserve -> call -> settle transaction shape. A query embedding is
//     ~30 tokens and ~$0.000003; wrapping that in a two-transaction
//     reservation costs more database round-trips than the call itself is
//     worth, on a database where ~2s authenticated latency is normal. Runaway
//     spend comes from INGESTION (a 500-page upload), and that is gated at
//     upload time and run on a queue — see phase-7.md D5.
//   * the Claude token budget. Embedding spend is added to
//     ai_budget_periods.costMicroUsd, but NOT to tokensReserved/tokensActual.
//     Voyage tokens are 50-250x cheaper, so folding them into the same counter
//     would silently DILUTE the school's cap rather than tighten it (D4).
// ---------------------------------------------------------------------------

export const EMBEDDING_PORT = Symbol("EMBEDDING_PORT");

export const EMBEDDING_ERROR_CODES = {
  NOT_CONFIGURED: "EMBEDDING_NOT_CONFIGURED",
} as const;

export interface EmbedParams {
  readonly schoolId: string;
  /** Set for ingestion, null for a query embedding. */
  readonly documentId?: string | null;
  readonly inputs: readonly string[];
  readonly inputType: EmbeddingInputType;
  readonly model?: EmbeddingModelId;
}

export interface EmbedOutcome {
  readonly embeddings: number[][];
  readonly totalTokens: number;
  readonly costMicroUsd: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly port: EmbeddingPort | null;

  constructor(
    private readonly config: ConfigService,
    // Injectable so specs can supply a fake port. In production nothing
    // provides EMBEDDING_PORT, so this is undefined and the real client is
    // built from VOYAGE_API_KEY. @Optional() + an explicit token are both
    // required for Nest to resolve this without a provider registered.
    @Optional() @Inject(EMBEDDING_PORT) port?: EmbeddingPort,
  ) {
    if (port) {
      this.port = port;
      return;
    }
    this.port = createVoyageClient(this.config.get<string>("VOYAGE_API_KEY"));
    if (!this.port) {
      this.logger.warn(
        "VOYAGE_API_KEY is not configured — curriculum features will report themselves disabled (EMBEDDING_NOT_CONFIGURED)",
      );
    }
  }

  /**
   * True when a real embedding call could be attempted.
   *
   * Feature modules should branch on this to hide or disable curriculum
   * affordances rather than letting a user click into an error — the same
   * contract AiGenerationService.isConfigured() provides.
   */
  isConfigured(): boolean {
    return this.port !== null;
  }

  /** The dimension every stored vector must have. Re-exported so callers do not import from packages/ai directly. */
  get dimensions(): number {
    return EMBEDDING_DIMENSIONS;
  }

  async embed(params: EmbedParams): Promise<EmbedOutcome> {
    if (!this.port) {
      // Fail soft, and loudly to the CALLER — not a crash, and not a silent
      // empty result that a retrieval path would mistake for "no matches".
      throw new ForbiddenError(
        EMBEDDING_ERROR_CODES.NOT_CONFIGURED,
        "Curriculum features are not configured on this deployment.",
      );
    }
    if (params.inputs.length === 0) {
      return { embeddings: [], totalTokens: 0, costMicroUsd: 0 };
    }

    const model = params.model ?? EMBEDDING_MODELS.VOYAGE_4;
    const startedAt = Date.now();

    let embeddings: number[][] = [];
    let totalTokens = 0;
    let failure: string | null = null;

    try {
      const result = await this.port.embed({
        model,
        inputs: params.inputs,
        inputType: params.inputType,
      });
      embeddings = result.embeddings;
      totalTokens = result.totalTokens;
    } catch (err) {
      // Redacted before write — never the document text, never the key.
      failure = err instanceof Error ? err.message.slice(0, 500) : "Unknown embedding error";
    }

    const latencyMs = Date.now() - startedAt;
    const costMicroUsd = estimateEmbeddingCostMicroUsd(model, totalTokens);

    // Ledger EVERY call, success or failure. A failed call still consumed
    // latency and may still have been billed; a ledger with a hole in it for
    // failures cannot answer "why did this month cost that".
    await this.record({
      schoolId: params.schoolId,
      documentId: params.documentId ?? null,
      model,
      purpose: params.documentId ? "ingest" : "query",
      inputTokens: totalTokens,
      latencyMs,
      costMicroUsd,
      success: failure === null,
      errorMessage: failure,
    });

    if (failure !== null) throw new Error(failure);
    return { embeddings, totalTokens, costMicroUsd };
  }

  private async record(row: {
    schoolId: string;
    documentId: string | null;
    model: string;
    purpose: string;
    inputTokens: number;
    latencyMs: number;
    costMicroUsd: number;
    success: boolean;
    errorMessage: string | null;
  }): Promise<void> {
    try {
      await withTenant(row.schoolId, async (db) => {
        await db.embeddingGeneration.create({ data: row });

        // Money is money: embedding spend joins the period's cost total so the
        // AI Usage page shows the TRUE platform cost, not the Claude-only
        // subset. Token counters are deliberately untouched (D4).
        //
        // Upsert rather than update: a school's first activity in a month may
        // well be an embedding, so the period row may not exist yet.
        await db.aIBudgetPeriod.upsert({
          where: {
            schoolId_periodStart: {
              schoolId: row.schoolId,
              periodStart: currentPeriodStart(),
            },
          },
          create: {
            schoolId: row.schoolId,
            periodStart: currentPeriodStart(),
            costMicroUsd: row.costMicroUsd,
          },
          update: { costMicroUsd: { increment: row.costMicroUsd } },
        });
      });
    } catch (err) {
      // A ledger failure must not turn a successful embedding into a failed
      // one — the caller already has its vectors. Logged loudly instead, with
      // the price-table version so a reconciliation can find what was missed.
      this.logger.error(
        `Failed to record embedding usage for school ${row.schoolId} (prices ${EMBEDDING_PRICE_TABLE_VERSION}): ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    }
  }
}
