// Phase 7 / CP2 — batch planning for embedding ingestion (D4a consequence 1).
//
// "Batch aggressively" is the instruction; this module is what makes it a
// property of the code rather than an intention. It is pure and separate from
// the HTTP call on purpose, so the packing rules can be tested exhaustively
// without spending a token.
//
// Two ceilings bind simultaneously and a correct plan respects BOTH:
//   * VOYAGE_MAX_INPUTS_PER_REQUEST (1,000) — a hard vendor limit.
//   * EMBEDDING_MAX_TOKENS_PER_REQUEST — our own budget, deliberately
//     conservative because the token figures are estimates (see chunking.ts).
//
// Greedy first-fit in ORDINAL ORDER, not best-fit bin packing. Two reasons:
// the marginal packing efficiency of a smarter algorithm is worth nothing here
// (batches are already near-full), and preserving order keeps the mapping from
// batch results back to chunk ordinals trivial — and a mis-mapped embedding is
// the single most insidious bug available in this subsystem, because it
// retrieves plausible-looking wrong content rather than failing.

import {
  EMBEDDING_MAX_TOKENS_PER_REQUEST,
  VOYAGE_MAX_INPUTS_PER_REQUEST,
} from "./embeddings.js";

export interface BatchableItem {
  readonly content: string;
  /** Estimated token count — see chunking.ts/estimateTokens. */
  readonly tokenCount: number;
}

export interface BatchPlanOptions {
  readonly maxInputs?: number;
  readonly maxTokens?: number;
}

export interface EmbeddingBatch<T> {
  readonly items: readonly T[];
  /** Sum of the items' estimated token counts. */
  readonly estimatedTokens: number;
  /** Index of this batch in the plan, for progress logging. */
  readonly index: number;
}

/**
 * Pack items into the fewest requests that respect both ceilings.
 *
 * An item whose OWN token estimate exceeds the per-request budget is placed in
 * a batch by itself rather than dropped or truncated. It will very likely
 * still succeed — the chunker caps chunks far below this budget, so a
 * single-item overflow means the estimate was badly wrong for that text — and
 * failing the whole document over one dense chunk would be the wrong trade.
 * Silently truncating would be worse still: it stores an embedding that does
 * not represent the content it is filed under.
 */
export function planEmbeddingBatches<T extends BatchableItem>(
  items: readonly T[],
  options: BatchPlanOptions = {},
): Array<EmbeddingBatch<T>> {
  const maxInputs = Math.max(1, options.maxInputs ?? VOYAGE_MAX_INPUTS_PER_REQUEST);
  const maxTokens = Math.max(1, options.maxTokens ?? EMBEDDING_MAX_TOKENS_PER_REQUEST);

  const batches: Array<EmbeddingBatch<T>> = [];
  let current: T[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({ items: current, estimatedTokens: currentTokens, index: batches.length });
    current = [];
    currentTokens = 0;
  };

  for (const item of items) {
    const tokens = Math.max(0, item.tokenCount);

    // Oversized on its own: flush what we have, then send it alone.
    if (tokens > maxTokens) {
      flush();
      batches.push({ items: [item], estimatedTokens: tokens, index: batches.length });
      continue;
    }

    const wouldExceedInputs = current.length + 1 > maxInputs;
    const wouldExceedTokens = currentTokens + tokens > maxTokens;
    if (current.length > 0 && (wouldExceedInputs || wouldExceedTokens)) flush();

    current.push(item);
    currentTokens += tokens;
  }
  flush();

  return batches;
}

/**
 * Total estimated tokens across a plan. Used for the upload-time cap check
 * and for the "this will take about N requests" figure in worker logs.
 */
export function planTotals<T extends BatchableItem>(
  batches: ReadonlyArray<EmbeddingBatch<T>>,
): { requests: number; estimatedTokens: number; items: number } {
  return {
    requests: batches.length,
    estimatedTokens: batches.reduce((a, b) => a + b.estimatedTokens, 0),
    items: batches.reduce((a, b) => a + b.items.length, 0),
  };
}
