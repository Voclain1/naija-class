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

// ---------------------------------------------------------------------------
// VISION — image token arithmetic.
//
// Lives here, next to the price table, because it is the same KIND of thing:
// per-model arithmetic that turns a request into a token count. The budget
// reservation needs it BEFORE the call (CLAUDE.md: "Per-school monthly token
// budget enforced before the call, not after"), and the reservation has no
// other way to know an image is attached — estimateInputTokens() is a
// chars/4 approximation and an image contributes no characters.
//
// Claude views images in 28x28-pixel patches, one visual token per patch, so
// an image costs ceil(w/28) * ceil(h/28) visual tokens. Images larger than a
// model's tier limits are downscaled server-side BEFORE that arithmetic runs,
// which is what makes the cap below an accurate ceiling rather than a guess:
// whatever we send, we are never billed more than the tier's maximum.
//
// Two tiers, and the difference is the whole reason smart-student-import
// routes to Sonnet 5 rather than Haiku (docs/modules/smart-student-import.md
// §2): high-resolution models see ~3x the pixel detail, which on a densely
// ruled handwritten register is the difference between reading a name and
// guessing at it.
export const IMAGE_PATCH_PX = 28;

// Max visual tokens per image, per model. Sourced from Anthropic's vision
// docs (fetched 2026-08-20): "high-resolution" = Claude 4.7 and later
// (2576px long edge / 4784 visual tokens), "standard" = everything earlier
// (1568px long edge / 1568 visual tokens).
export const MODEL_MAX_VISUAL_TOKENS: Record<ModelId, number> = {
  [MODELS.HAIKU_4_5]: 1568, // standard tier — 4.5 predates the high-res tier
  [MODELS.SONNET_5]: 4784, // high-resolution tier
};

// Visual-token cost of one image on a given model. Deliberately takes
// dimensions rather than bytes: patch count is a function of pixels, and file
// size (JPEG compression ratio) has no bearing on it at all. That is also why
// the upload path has to decode the image header to get w/h before calling —
// there is no shortcut from Content-Length.
export function estimateImageTokens(model: ModelId, widthPx: number, heightPx: number): number {
  const cap = MODEL_MAX_VISUAL_TOKENS[model];
  if (!cap) throw new Error(`estimateImageTokens: no visual-token cap for model "${model}"`);
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    // A caller that cannot determine dimensions must not silently reserve
    // zero. Charging the full tier cap is the safe direction and matches the
    // "over-reserve, settle reconciles down" discipline in models' pricing.
    return cap;
  }
  const patches = Math.ceil(widthPx / IMAGE_PATCH_PX) * Math.ceil(heightPx / IMAGE_PATCH_PX);
  return Math.min(patches, cap);
}

// Rounded to whole micro-USD (the column is Int). Rounding up rather than
// nearest, again because under-reporting spend is the worse error.
export function estimateCostMicroUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICING[model];
  if (!price) throw new Error(`estimateCostMicroUsd: no price entry for model "${model}"`);
  return Math.ceil(inputTokens * price.inputMicroUsdPerToken + outputTokens * price.outputMicroUsdPerToken);
}
