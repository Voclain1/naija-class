// LIVE check — the CP2 ingestion path against the real Voyage API.
//
// Complements live-embedding.ts (CP1, which proved the request shape and the
// 1024-dimension contract). This one proves the things CP2 added, and which
// cannot be proved offline:
//
//   1. THE RATE LIMIT IS ACTUALLY LIFTED. D4a recorded 3 requests/minute for an
//      account with no payment method, measured 2026-09-02. A payment method
//      has since been added; this asserts that empirically rather than assuming
//      it, because the entire batching-and-backoff design was sized against the
//      old number and it would be embarrassing to build on a stale reading.
//   2. A REALISTIC DOCUMENT EMBEDS THROUGH THE REAL BATCH PLANNER — many chunks
//      packed into few requests, in order, every vector the right length.
//   3. Retry/backoff sits in the live path without interfering when nothing
//      goes wrong.
//
// Skipped, loudly, when VOYAGE_API_KEY is absent — same contract as
// live-embedding.ts and evals/cases/live-generation.ts. Not part of
// `pnpm ai:eval`: it spends real tokens and depends on a network call.
//
// Run: node ../../node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs evals/live-curriculum-ingest.ts
// (with VOYAGE_API_KEY in the environment)

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODELS,
  createVoyageClient,
  estimateEmbeddingCostMicroUsd,
} from "../src/embeddings.js";
import { chunkDocument } from "../src/chunking.js";
import { planEmbeddingBatches, planTotals } from "../src/embedding-batching.js";
import { classifyVendorError, retryWithBackoff } from "../src/retry.js";

/**
 * A synthetic scheme of work with real structure — terms, weeks, topics — so
 * the chunker exercises its heading detection rather than falling straight to
 * the windowing fallback.
 */
function syntheticScheme(weeks: number): string {
  let out = "FIRST TERM SCHEME OF WORK\nBasic Science, JSS 2\n";
  const topics = [
    "Living and Non-living Things",
    "Photosynthesis",
    "Transpiration",
    "The Water Cycle",
    "Simple Machines",
    "Measurement of Length",
    "Heat and Temperature",
    "Magnets",
  ];
  for (let w = 1; w <= weeks; w++) {
    const topic = topics[(w - 1) % topics.length];
    out += `\nWEEK ${w}\nTOPIC: ${topic}\n`;
    out += `Pupils should be able to define ${topic!.toLowerCase()} in their own words and give at `;
    out += `least three examples drawn from the school compound or their own homes. The teacher `;
    out += `demonstrates using locally available materials, and pupils record their observations `;
    out += `in their notebooks. Evaluation: pupils answer the five questions at the end of the `;
    out += `chapter and submit their notebooks before the next lesson begins.\n`;
    out += `SUB-TOPIC: Common misconceptions\n`;
    out += `Address the frequent confusion between ${topic!.toLowerCase()} and related ideas met `;
    out += `in earlier terms, using a comparison table drawn on the board.\n`;
  }
  return out;
}

async function main(): Promise<void> {
  const port = createVoyageClient(process.env.VOYAGE_API_KEY);
  if (!port) {
    console.log(
      "○ SKIPPED — VOYAGE_API_KEY not set (or is a placeholder). The offline specs in\n" +
        "  apps/api/src/modules/curriculum/ still gate this work.",
    );
    return;
  }

  const model = EMBEDDING_MODELS.VOYAGE_4;
  const failures: string[] = [];

  // ---- 1. is the rate limit actually lifted? ---------------------------
  // Under the unpaid tier's 3 requests/minute, the fourth of these refuses with
  // 429. Under the paid tier all eight succeed in a couple of seconds.
  console.log("── 1. rate limit ──");
  const burstStarted = Date.now();
  const burst = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      try {
        await port.embed({ model, inputType: "document", inputs: [`rate probe ${i}`] });
        return null;
      } catch (err) {
        return classifyVendorError(err);
      }
    }),
  );
  const burstMs = Date.now() - burstStarted;
  const refused = burst.filter((k) => k === "rate-limit").length;
  if (refused > 0) {
    failures.push(
      `${refused}/8 concurrent requests were rate-limited — the reduced tier appears to still be in effect. ` +
        `Check that a payment method is attached to the Voyage account (D4a).`,
    );
  }
  console.log(
    `✓ 8 concurrent requests in ${burstMs}ms — ${8 - refused} accepted, ${refused} rate-limited`,
  );

  // ---- 2. a realistic document through the real batch planner ----------
  console.log("\n── 2. batched ingestion ──");
  const chunks = chunkDocument(syntheticScheme(24));
  const batches = planEmbeddingBatches(chunks);
  const totals = planTotals(batches);
  console.log(
    `  ${chunks.length} chunks → ${totals.requests} request(s), ~${totals.estimatedTokens} estimated tokens`,
  );
  if (totals.items !== chunks.length) {
    failures.push(`batch plan carries ${totals.items} items for ${chunks.length} chunks`);
  }

  const vectors: number[][] = [];
  let realTokens = 0;
  let retries = 0;
  const ingestStarted = Date.now();

  for (const batch of batches) {
    const outcome = await retryWithBackoff(
      () =>
        port.embed({
          model,
          inputType: "document",
          inputs: batch.items.map((c) => c.content),
        }),
      {
        onRetry: ({ attempt, delayMs, kind }) => {
          retries += 1;
          console.log(`  … batch ${batch.index + 1} hit ${kind} (attempt ${attempt}), waiting ${delayMs}ms`);
        },
      },
    );
    if (outcome.embeddings.length !== batch.items.length) {
      failures.push(
        `batch ${batch.index} returned ${outcome.embeddings.length} vectors for ${batch.items.length} inputs`,
      );
    }
    vectors.push(...outcome.embeddings);
    realTokens += outcome.totalTokens;
  }
  const ingestMs = Date.now() - ingestStarted;

  console.log(
    `✓ embedded ${vectors.length} chunks in ${ingestMs}ms across ${batches.length} request(s), ${retries} retr${retries === 1 ? "y" : "ies"}`,
  );
  console.log(
    `  real tokens=${realTokens} (estimate was ${totals.estimatedTokens}) cost=${estimateEmbeddingCostMicroUsd(model, realTokens)} micro-USD`,
  );

  // ---- 3. every vector is the schema's dimension -----------------------
  const wrong = vectors.filter((v) => v.length !== EMBEDDING_DIMENSIONS).length;
  if (wrong > 0) {
    failures.push(`${wrong} vectors were not ${EMBEDDING_DIMENSIONS}-dimensional`);
  }
  console.log(`✓ all ${vectors.length} vectors are ${EMBEDDING_DIMENSIONS}-dimensional`);

  // ---- 4. the estimate is a usable budget ------------------------------
  // Not asserting accuracy — the heuristic is documented as approximate. What
  // matters is that it does not UNDERSHOOT badly, since batching packs to it.
  const ratio = totals.estimatedTokens / Math.max(1, realTokens);
  console.log(`✓ token estimate / real = ${ratio.toFixed(2)}`);
  if (ratio < 0.5) {
    failures.push(
      `token estimate is ${ratio.toFixed(2)}x reality — batches would overshoot the per-request budget`,
    );
  }

  if (failures.length > 0) {
    console.error("\n✗ FAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll live curriculum ingestion checks passed.");
}

main().catch((err) => {
  console.error("✗ live ingestion check threw:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
