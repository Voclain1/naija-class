import { Prisma, withTenant } from "@school-kit/db";
import {
  chunkDocument,
  embeddableText,
  planEmbeddingBatches,
  planTotals,
  retryWithBackoff,
  type BackoffOptions,
  type Chunk,
} from "@school-kit/ai";

import type { EmbeddingService } from "../../../common/embeddings/embedding.service";
import type { StorageService } from "../../../common/storage";
import { parsePastedText, parseUploadedDocument } from "../parsing/document-parser";

// ---------------------------------------------------------------------------
// The ingestion handler — parse, chunk, batch-embed, store.
//
// Written as a plain function taking its collaborators rather than as a method
// on the processor, so it can be tested against a real Postgres and a fake
// embedding port without standing up a BullMQ Worker. Same shape as the CSV
// importer's runCommitHandler, and for the same reason.
//
// THE THREE D4a REQUIREMENTS ARE ALL HERE, and each is load-bearing:
//
//   1. BATCH AGGRESSIVELY — planEmbeddingBatches packs to the 1,000-input
//      vendor limit under a token budget. A 60-chunk document is one request,
//      not sixty.
//   2. A 429 IS A RETRY, NOT A FAILED DOCUMENT — retryWithBackoff wraps each
//      batch. Crucially the retry is per BATCH, so a rate limit on batch 12 of
//      40 waits and continues rather than restarting the document and
//      re-spending on the eleven batches that already succeeded.
//   3. Caps are enforced at upload, not here — see curriculum.service.ts.
//
// Idempotency: the handler deletes any chunks already present for the document
// before inserting. A crash halfway through leaves partial chunks, and BullMQ
// will retry the job; without the delete the retry would double every chunk it
// had already written. Re-embedding the whole document on retry costs money we
// have already spent once, which is unfortunate — but a corpus with duplicated
// chunks silently skews every retrieval that touches them, and that is worse
// than a second bill measured in fractions of a cent.
// ---------------------------------------------------------------------------

export interface IngestHandlerDeps {
  readonly documentId: string;
  readonly schoolId: string;
  readonly storage: StorageService;
  readonly embeddings: EmbeddingService;
  readonly logger: { log: (m: string) => void; warn: (m: string) => void };
  /** Injected in specs to make backoff instant and deterministic. */
  readonly backoff?: BackoffOptions;
}

export interface IngestResult {
  readonly chunkCount: number;
  readonly requests: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly skipped: boolean;
}

export async function runIngestHandler(deps: IngestHandlerDeps): Promise<IngestResult> {
  const { documentId, schoolId, storage, embeddings, logger } = deps;

  // ---- 1. claim the document -------------------------------------------
  const claimed = await withTenant(schoolId, async (db) => {
    const doc = await db.curriculumDocument.findFirst({
      where: { id: documentId, schoolId },
      select: { id: true, status: true },
    });
    if (!doc) return null;
    // PENDING is the normal path; PROCESSING means a previous attempt died
    // mid-run and BullMQ is retrying, which must be allowed to resume. READY
    // and FAILED are terminal for this job — re-running would re-spend.
    if (doc.status !== "PENDING" && doc.status !== "PROCESSING") return doc.status;
    await db.curriculumDocument.update({
      where: { id: documentId },
      data: { status: "PROCESSING", errorMessage: null },
    });
    return "CLAIMED" as const;
  });

  if (claimed === null) {
    logger.warn(`ingest: document ${documentId} no longer exists; skipping`);
    return { chunkCount: 0, requests: 0, totalTokens: 0, costMicroUsd: 0, skipped: true };
  }
  if (claimed !== "CLAIMED") {
    logger.warn(`ingest: document ${documentId} is ${claimed}, not PENDING/PROCESSING; skipping`);
    return { chunkCount: 0, requests: 0, totalTokens: 0, costMicroUsd: 0, skipped: true };
  }

  // ---- 2. re-derive the chunks ------------------------------------------
  // Re-parsed from storage rather than carried on the job payload. See the
  // service header: chunking is deterministic, so this reproduces exactly what
  // the request-path cap check measured, and a retry after a crash needs no
  // checkpoint to be correct.
  const sourceBytes = await storage.get(schoolId, { kind: "curriculum-document", documentId });
  const parsed = looksLikeText(sourceBytes)
    ? parsePastedText(sourceBytes.toString("utf8"))
    : await parseUploadedDocument(sourceBytes, null);
  const chunks = chunkDocument(parsed.text);

  if (chunks.length === 0) {
    throw new Error("ingest: document produced no chunks on re-parse");
  }

  // ---- 3. plan the batches ---------------------------------------------
  const batches = planEmbeddingBatches(chunks);
  const totals = planTotals(batches);
  logger.log(
    `ingest: document ${documentId} — ${chunks.length} chunks in ${totals.requests} request(s), ~${totals.estimatedTokens} estimated tokens`,
  );

  // ---- 4. embed, with per-batch backoff ---------------------------------
  const vectors: number[][] = [];
  let totalTokens = 0;
  let costMicroUsd = 0;

  for (const batch of batches) {
    const outcome = await retryWithBackoff(
      () =>
        embeddings.embed({
          schoolId,
          documentId,
          // Heading INCLUDED — see embeddableText (D15). Retrieval is over one
          // vector per chunk, so the heading has to be inside it to matter.
          inputs: batch.items.map((c) => embeddableText(c)),
          inputType: "document",
        }),
      {
        ...deps.backoff,
        onRetry: ({ attempt, delayMs, kind }) => {
          // Logged at warn, not error: this is the system working as designed.
          // A 429 here is not a fault, it is the rate limit doing its job, and
          // an error-level line would train whoever reads these to ignore them.
          logger.warn(
            `ingest: document ${documentId} batch ${batch.index + 1}/${batches.length} hit ${kind} on attempt ${attempt}; retrying in ${delayMs}ms`,
          );
          deps.backoff?.onRetry?.({ attempt, delayMs, kind, error: undefined });
        },
      },
    );

    if (outcome.embeddings.length !== batch.items.length) {
      // Should be impossible — the port already checks this — but a silent
      // length mismatch would misalign every subsequent chunk's vector, which
      // is the one failure in this subsystem that produces confident wrong
      // answers rather than an error.
      throw new Error(
        `ingest: batch ${batch.index} returned ${outcome.embeddings.length} vectors for ${batch.items.length} chunks`,
      );
    }
    vectors.push(...outcome.embeddings);
    totalTokens += outcome.totalTokens;
    costMicroUsd += outcome.costMicroUsd;
  }

  // ---- 5. store ---------------------------------------------------------
  await writeChunks(schoolId, documentId, chunks, vectors);

  await withTenant(schoolId, (db) =>
    db.curriculumDocument.update({
      where: { id: documentId },
      data: { status: "READY", chunkCount: chunks.length, errorMessage: null },
    }),
  );

  logger.log(
    `ingest: document ${documentId} READY — ${chunks.length} chunks, ${totalTokens} tokens, ${costMicroUsd} micro-USD`,
  );

  return {
    chunkCount: chunks.length,
    requests: totals.requests,
    totalTokens,
    costMicroUsd,
    skipped: false,
  };
}

/**
 * Insert chunk rows with their vectors.
 *
 * RAW SQL, necessarily: `embedding` is `Unsupported("vector(1024)")` and
 * Prisma Client can neither read nor write it. CLAUDE.md's raw-SQL rule
 * therefore applies directly — this runs inside withTenant, which has already
 * issued `SET LOCAL app.current_school_id`, AND the statement carries
 * `school_id` explicitly. Belt and braces, as D8 requires.
 *
 * Written as one multi-row INSERT per slice rather than a row at a time: a
 * 500-chunk document is 500 round-trips otherwise, on a database where
 * ~2s authenticated latency is normal.
 */
async function writeChunks(
  schoolId: string,
  documentId: string,
  chunks: readonly Chunk[],
  vectors: readonly number[][],
): Promise<void> {
  const SLICE = 200;
  await withTenant(schoolId, async (db) => {
    // Idempotency — see the handler header.
    await db.curriculumChunk.deleteMany({ where: { documentId, schoolId } });

    for (let start = 0; start < chunks.length; start += SLICE) {
      const slice = chunks.slice(start, start + SLICE);
      const values = slice.map((chunk, i) => {
        const vector = vectors[start + i];
        // Parameterised for every user-controlled value. The vector is
        // serialised into the literal because pgvector's input syntax is a
        // string like '[0.1,0.2]' and it is composed here from NUMBERS we
        // received from the vendor and validated for length — there is no
        // path for document text to reach this string.
        return Prisma.sql`(
          gen_random_uuid(),
          ${schoolId},
          ${documentId},
          ${chunk.ordinal},
          ${chunk.heading},
          ${chunk.content},
          ${chunk.tokenCount},
          ${toVectorLiteral(vector)}::vector,
          now()
        )`;
      });

      await db.$executeRaw`
        INSERT INTO curriculum_chunks
          (id, school_id, document_id, ordinal, heading, content, token_count, embedding, created_at)
        VALUES ${Prisma.join(values)}
      `;
    }
  });
}

function toVectorLiteral(vector: readonly number[]): string {
  for (const v of vector) {
    if (!Number.isFinite(v)) throw new Error("ingest: embedding contains a non-finite value");
  }
  return `[${vector.join(",")}]`;
}

/**
 * Pasted text was stored as UTF-8; an uploaded PDF was stored as bytes. The
 * magic-byte check in the parser decides for files, but pasted text has no
 * magic bytes, so the worker distinguishes them the same cheap way.
 */
function looksLikeText(buffer: Buffer): boolean {
  return !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
}
