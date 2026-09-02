// THE ONLY FILE IN THIS REPO PERMITTED TO CALL THE VOYAGE API.
//
// Same shape and same reasoning as ./client.ts is for Anthropic: everything
// above this layer talks to `EmbeddingPort`, never to the HTTP endpoint. That
// is what makes ledger and fail-soft behaviour testable without a live key —
// the specs inject a fake port — and what stops a future feature module
// quietly making an unledgered embedding call.
//
// Unlike the Anthropic case there is no SDK to ban by import name; Voyage's
// REST API is one POST and pulling in a client library to make it would be
// more dependency than the call is worth. The boundary is therefore the
// BASE URL constant below, which no other file may reference — enforced by a
// `no-restricted-syntax` rule in packages/config/eslint/base.js.
//
// API contract verified against docs.voyageai.com/reference/embeddings-api on
// 2026-09-02 rather than assumed:
//   POST https://api.voyageai.com/v1/embeddings
//   Authorization: Bearer <key>
//   { input: string | string[], model, input_type?, output_dimension? }
//   -> { data: [{ embedding: number[], index }], usage: { total_tokens } }

const VOYAGE_EMBEDDINGS_URL = "https://api.voyageai.com/v1/embeddings";

// ---------------------------------------------------------------------------
// Models and pricing
// ---------------------------------------------------------------------------

export const EMBEDDING_MODELS = {
  VOYAGE_4: "voyage-4",
  VOYAGE_4_LITE: "voyage-4-lite",
  VOYAGE_4_LARGE: "voyage-4-large",
} as const;

export type EmbeddingModelId = (typeof EMBEDDING_MODELS)[keyof typeof EMBEDDING_MODELS];

// The dimension every Phase 7 vector column is sized for. voyage-4's default,
// confirmed 2026-09-02 (docs/modules/phase-7.md D2). Sent explicitly rather
// than relying on the API default so the ingestion and query paths cannot
// drift apart by one of them omitting it.
export const EMBEDDING_DIMENSIONS = 1024;

// Micro-USD per 1M tokens. Voyage bills input tokens only — there is no output
// side to an embedding, which is one of the reasons these calls cannot share
// ai_generations' row shape (phase-7.md D3).
//
// Checked against docs.voyageai.com/docs/pricing on 2026-09-02. Every model
// here carries a 200M-token free allowance, so at v1 volumes the real bill is
// zero; the ledger still records what it WOULD cost, because a cost ledger
// that stops counting once something is free stops being a cost ledger.
export const EMBEDDING_PRICING_MICRO_USD_PER_MTOK: Record<EmbeddingModelId, number> = {
  "voyage-4": 60_000, // $0.06 / 1M
  "voyage-4-lite": 20_000, // $0.02 / 1M
  "voyage-4-large": 120_000, // $0.12 / 1M
};

// Bumped whenever the table above changes, and written to every ledger row —
// same contract as PRICE_TABLE_VERSION in ./models.ts, so a historical row can
// always be traced to the prices it was computed under.
export const EMBEDDING_PRICE_TABLE_VERSION = "voyage-2026-09-02";

export function estimateEmbeddingCostMicroUsd(
  model: EmbeddingModelId,
  totalTokens: number,
): number {
  const perMTok = EMBEDDING_PRICING_MICRO_USD_PER_MTOK[model];
  // Round UP: a cost ledger that rounds spend down is wrong in the direction
  // that matters. Sub-micro-dollar calls therefore record 1, not 0.
  return Math.ceil((totalTokens * perMTok) / 1_000_000);
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * `document` when embedding corpus text, `query` when embedding a search
 * string. Voyage embeds the two asymmetrically and retrieval quality drops
 * measurably if both sides use the same input_type, so this is required
 * rather than optional — a caller that has to think about it once is better
 * than a default that silently degrades every search.
 */
export type EmbeddingInputType = "document" | "query";

export interface EmbeddingRequest {
  readonly model: EmbeddingModelId;
  readonly inputs: readonly string[];
  readonly inputType: EmbeddingInputType;
}

export interface EmbeddingResult {
  /** One vector per input, in the order the inputs were given. */
  readonly embeddings: number[][];
  readonly totalTokens: number;
  readonly model: string;
}

export interface EmbeddingPort {
  embed(req: EmbeddingRequest): Promise<EmbeddingResult>;
}

class VoyageHttpPort implements EmbeddingPort {
  constructor(private readonly apiKey: string) {}

  async embed(req: EmbeddingRequest): Promise<EmbeddingResult> {
    const response = await fetch(VOYAGE_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [...req.inputs],
        model: req.model,
        input_type: req.inputType,
        output_dimension: EMBEDDING_DIMENSIONS,
      }),
    });

    if (!response.ok) {
      // Body text, not the request — an error message must never echo the
      // document being embedded back into a log or a ledger row.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Voyage embeddings request failed: ${response.status} ${response.statusText}${
          detail ? ` — ${detail.slice(0, 300)}` : ""
        }`,
      );
    }

    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[]; index?: number }>;
      usage?: { total_tokens?: number };
      model?: string;
    };

    const data = body.data ?? [];
    if (data.length !== req.inputs.length) {
      throw new Error(
        `Voyage returned ${data.length} embeddings for ${req.inputs.length} inputs`,
      );
    }

    // Sort by the API's own index rather than trusting array order. The docs
    // return them in order today; relying on that silently would make a future
    // batching change corrupt the chunk-to-vector mapping, and a mis-mapped
    // embedding is invisible — it retrieves plausible-looking wrong content.
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const embeddings = ordered.map((d) => {
      if (!d.embedding || d.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Voyage returned an embedding of ${d.embedding?.length ?? 0} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        );
      }
      return d.embedding;
    });

    return {
      embeddings,
      totalTokens: body.usage?.total_tokens ?? 0,
      model: body.model ?? req.model,
    };
  }
}

/**
 * Returns null for a missing, blank or placeholder key.
 *
 * Null is the FAIL-SOFT signal, and it is deliberate: a missing env var must
 * make the feature report itself unavailable, never crash the API at boot. A
 * boot crash from a missing env var has already taken this production down
 * once (see AiGenerationService's constructor, which does the same thing for
 * ANTHROPIC_API_KEY, and docs/modules/phase-5.md D11).
 */
export function createVoyageClient(apiKey: string | undefined | null): EmbeddingPort | null {
  if (!apiKey || apiKey.trim() === "") return null;
  if (apiKey.includes("replace-me") || apiKey.includes("placeholder")) return null;
  return new VoyageHttpPort(apiKey);
}
