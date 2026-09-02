// LIVE check — one real call to the Voyage embeddings API.
//
// Exists because CP1's contract with the vendor cannot be proven offline. The
// unit specs use a fake EmbeddingPort and are the right place for fail-soft and
// ledger behaviour; they say nothing about whether the real endpoint accepts
// our request shape or returns the dimensionality the schema is built around.
//
// Skipped, loudly, when VOYAGE_API_KEY is absent — the same contract
// evals/cases/live-generation.ts has for ANTHROPIC_API_KEY. Not part of
// `pnpm ai:eval`: it spends real tokens (a handful, against a 200M free
// allowance) and depends on a network call.
//
// Run: pnpm --filter @school-kit/ai exec dotenv -e ../../.env -- tsx evals/live-embedding.ts
//
// What it asserts, and why each one earns its place:
//   1. The call succeeds at all — the request shape is right.
//   2. The vector is EXACTLY EMBEDDING_DIMENSIONS long. This is the one that
//      matters most: `curriculum_chunks.embedding` is `vector(1024)` and a
//      mismatch is an insert failure at ingestion time, discovered by a
//      teacher rather than by us. Confirming it empirically closes phase-7.md
//      D2, which was resolved from documentation.
//   3. `input_type` is honoured — a query and a document embedding of the same
//      text must NOT be identical, because Voyage embeds the two
//      asymmetrically and retrieval quality depends on it.
//   4. Semantic ordering is sane — a curriculum-ish query is closer to a
//      curriculum chunk than to an unrelated one. This is a smoke test of
//      usefulness, not a quality benchmark; the real retrieval-precision work
//      is CP4.

import {
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODELS,
  createVoyageClient,
  estimateEmbeddingCostMicroUsd,
} from "../src/embeddings.js";

// Voyage applies a REDUCED rate limit of 3 requests/minute until a payment
// method is added to the account (observed 2026-09-02: the fourth call in this
// script returned 429 with exactly that explanation). This script makes four
// calls, so it paces itself rather than pretending the limit is not there.
//
// This is a real operational constraint, not a test artefact — CP2's ingestion
// path will meet it far harder than this script does. See the note in
// docs/modules/phase-7.md.
const RATE_LIMIT_PAUSE_MS = 21_000;

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_PAUSE_MS));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function main(): Promise<void> {
  const port = createVoyageClient(process.env.VOYAGE_API_KEY);
  if (!port) {
    console.log(
      "○ SKIPPED — VOYAGE_API_KEY not set (or is a placeholder). The offline specs in\n" +
        "  apps/api/src/common/embeddings/embedding.service.spec.ts still gate this work.",
    );
    return;
  }

  const model = EMBEDDING_MODELS.VOYAGE_4;
  const failures: string[] = [];

  // ---- 1. a real call --------------------------------------------------
  const started = Date.now();
  const docs = await port.embed({
    model,
    inputType: "document",
    inputs: [
      "Week 5: Photosynthesis. Pupils should be able to state the word equation and name the raw materials.",
      "Week 12: Simple interest. Calculate interest on a principal at a given rate over time.",
    ],
  });
  const latencyMs = Date.now() - started;

  console.log(`✓ call succeeded — model=${docs.model} latency=${latencyMs}ms`);
  console.log(
    `  tokens=${docs.totalTokens} estimated cost=${estimateEmbeddingCostMicroUsd(model, docs.totalTokens)} micro-USD`,
  );

  // ---- 2. dimensionality ----------------------------------------------
  for (const [i, v] of docs.embeddings.entries()) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      failures.push(`embedding ${i} has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
  }
  console.log(
    `✓ dimensionality — ${docs.embeddings.length} vectors, each ${docs.embeddings[0]?.length} (schema expects ${EMBEDDING_DIMENSIONS})`,
  );

  // ---- 3. input_type is honoured ---------------------------------------
  const sameText = "Week 5: Photosynthesis.";
  await pause();
  const asDoc = await port.embed({ model, inputType: "document", inputs: [sameText] });
  await pause();
  const asQuery = await port.embed({ model, inputType: "query", inputs: [sameText] });
  const asymmetry = cosine(asDoc.embeddings[0], asQuery.embeddings[0]);
  if (asymmetry > 0.9999) {
    failures.push(
      `document and query embeddings of identical text are indistinguishable (cosine ${asymmetry}) — input_type is not being applied`,
    );
  }
  console.log(`✓ input_type honoured — document vs query cosine ${asymmetry.toFixed(4)} (< 1.0)`);

  // ---- 4. semantic ordering --------------------------------------------
  await pause();
  const q = await port.embed({
    model,
    inputType: "query",
    inputs: ["How do plants make their own food?"],
  });
  const toPhotosynthesis = cosine(q.embeddings[0], docs.embeddings[0]);
  const toInterest = cosine(q.embeddings[0], docs.embeddings[1]);
  if (!(toPhotosynthesis > toInterest)) {
    failures.push(
      `a photosynthesis query ranked the simple-interest chunk higher (${toInterest} > ${toPhotosynthesis})`,
    );
  }
  console.log(
    `✓ semantic ordering — photosynthesis ${toPhotosynthesis.toFixed(4)} > simple interest ${toInterest.toFixed(4)}`,
  );

  if (failures.length > 0) {
    console.error("\n✗ FAILURES:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll live embedding checks passed.");
}

main().catch((err) => {
  console.error("✗ live embedding check threw:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
