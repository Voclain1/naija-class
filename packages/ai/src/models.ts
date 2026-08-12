// Model ids and the price table used to derive AIGeneration.costMicroUsd.
//
// NOTE: `as const` objects throughout, never TypeScript `enum` — see the
// landmine note in ./index.ts. An enum here would break Node's type-stripping
// resolution at runtime while CI stayed green.

// Model ids are exact strings. Do NOT append date suffixes — these aliases are
// complete as written and a suffixed variant 404s.
export const MODELS = {
  // High volume, short structured output: report-card comments, parent
  // summaries. Cheapest current model.
  HAIKU_4_5: "claude-haiku-4-5",
  // Low volume, quality-sensitive, structured output: lesson plans.
  SONNET_5: "claude-sonnet-5",
} as const;

export type ModelId = (typeof MODELS)[keyof typeof MODELS];

// Price table version tag, written to AIGeneration.pricedAtVersion on every
// row. Bump this string whenever the rates below change, so historical rows
// stay interpretable rather than silently mixing rates across time.
export const PRICE_TABLE_VERSION = "2026-08-10";

// Micro-USD per token.
//
// Convenient identity: dollars-per-million-tokens == micro-USD-per-token
// (1 USD / 1e6 tokens = 1e6 µUSD / 1e6 tokens = 1 µUSD/token), so these
// numbers read directly off Anthropic's published per-MTok pricing.
//
// CAVEAT — Claude Sonnet 5 is under introductory pricing ($2 in / $10 out per
// MTok) through 2026-08-31, after which it returns to the standard $3/$15
// encoded here. We deliberately encode the STANDARD rate: over-estimating cost
// is the safe direction for a spend ledger, and this keeps the table correct
// from 2026-09-01 onward without a dated branch. Real invoiced spend will be
// lower than the ledger says until then. This does not affect enforcement —
// the budget is enforced in TOKENS, not cost (phase-5.md D3).
export const MODEL_PRICING: Record<ModelId, { inputMicroUsdPerToken: number; outputMicroUsdPerToken: number }> = {
  [MODELS.HAIKU_4_5]: { inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 5 },
  [MODELS.SONNET_5]: { inputMicroUsdPerToken: 3, outputMicroUsdPerToken: 15 },
};

// Rounded to whole micro-USD (the column is Int). Rounding up rather than
// nearest, again because under-reporting spend is the worse error.
export function estimateCostMicroUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) throw new Error(`estimateCostMicroUsd: no price entry for model "${model}"`);
  return Math.ceil(inputTokens * price.inputMicroUsdPerToken + outputTokens * price.outputMicroUsdPerToken);
}
