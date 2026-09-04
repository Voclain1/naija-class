import { Prisma, withTenant } from "@school-kit/db";
import {
  embeddableText,
  planEmbeddingBatches,
  planTotals,
  retryWithBackoff,
  type BackoffOptions,
  type Chunk,
} from "@school-kit/ai";

import type { EmbeddingService } from "../../../common/embeddings/embedding.service";

// ---------------------------------------------------------------------------
// The embed handler — CP5's half of what used to be one ingestion job.
//
// THE ONE THING THAT MAKES THIS DIFFERENT FROM runIngestHandler, and it is the
// whole point of CP5: this reads chunks FROM THE DATABASE, never by re-parsing
// the source file.
//
// Before the review gate, re-deriving chunks from storage was strictly better —
// chunking is deterministic, so a retry after a crash reproduced exactly what
// the request-path cap check had measured, with no checkpoint to remember.
// After the gate that reasoning INVERTS. A teacher may have corrected a heading
// the parser got wrong, or discarded a contents page it should never have
// produced. Those corrections exist only in `curriculum_chunks`. Re-parsing
// would silently throw them away and embed the parser's original mistakes —
// the exact failure the review gate was built to prevent, reintroduced in the
// step that runs after it.
//
// So: the database is the source of truth from approval onward. The stored
// source file remains the record of what the school uploaded, and is still what
// a re-upload would be compared against, but it is no longer what gets embedded.
//
// IDEMPOTENCY, and why it is cheaper than the old handler's:
// only chunks with a NULL embedding are fetched and embedded. A job that dies
// after batch 12 of 40 resumes at 13 on retry, because the first twelve now
// hold vectors and drop out of the query. The old handler deleted every chunk
// and re-embedded the document from scratch, which was correct but paid the
// full vendor bill again. Here the natural query IS the checkpoint.
// ---------------------------------------------------------------------------

export interface EmbedHandlerDeps {
  readonly documentId: string;
  readonly schoolId: string;
  readonly embeddings: EmbeddingService;
  readonly logger: { log: (m: string) => void; warn: (m: string) => void };
  /** Injected in specs to make backoff instant and deterministic. */
  readonly backoff?: BackoffOptions;
}

export interface EmbedResult {
  readonly chunkCount: number;
  readonly embedded: number;
  readonly requests: number;
  readonly totalTokens: number;
  readonly costMicroUsd: number;
  readonly skipped: boolean;
}

interface PendingChunkRow {
  id: string;
  ordinal: number;
  heading: string | null;
  content: string;
  token_count: number;
}

const NOTHING: EmbedResult = {
  chunkCount: 0,
  embedded: 0,
  requests: 0,
  totalTokens: 0,
  costMicroUsd: 0,
  skipped: true,
};

export async function runEmbedHandler(deps: EmbedHandlerDeps): Promise<EmbedResult> {
  const { documentId, schoolId, embeddings, logger } = deps;

  // ---- 1. claim ---------------------------------------------------------
  // EMBEDDING is the only status this job may act on, and `approve` is the
  // only thing that sets it. That is the gate expressed as a state machine:
  // an AWAITING_REVIEW document reaching this handler means a job was
  // enqueued without an approval, and skipping is the correct response — not
  // embedding it anyway.
  const claimed = await withTenant(schoolId, async (db) => {
    const doc = await db.curriculumDocument.findFirst({
      where: { id: documentId, schoolId },
      select: { status: true },
    });
    return doc ? doc.status : null;
  });

  if (claimed === null) {
    logger.warn(`embed: document ${documentId} no longer exists; skipping`);
    return NOTHING;
  }
  if (claimed !== "EMBEDDING") {
    logger.warn(`embed: document ${documentId} is ${claimed}, not EMBEDDING; skipping`);
    return NOTHING;
  }

  // ---- 2. read what still needs a vector --------------------------------
  // Raw SQL because `embedding` is Unsupported("vector(1024)") — Prisma Client
  // cannot express `IS NULL` on it, or read it at all. Inside withTenant, so
  // `app.current_school_id` is already set, AND school_id is in the predicate:
  // belt and braces, as D8 requires.
  const pending = await withTenant(schoolId, (db) =>
    db.$queryRaw<PendingChunkRow[]>`
      SELECT id, ordinal, heading, content, token_count
      FROM curriculum_chunks
      WHERE document_id = ${documentId}::text
        AND school_id = ${schoolId}::text
        AND embedding IS NULL
      ORDER BY ordinal ASC
    `,
  );

  const totalChunks = await withTenant(schoolId, (db) =>
    db.curriculumChunk.count({ where: { documentId, schoolId } }),
  );

  if (totalChunks === 0) {
    // Every chunk was discarded during review. The service refuses to approve
    // an empty document, so reaching here means the rows vanished afterwards;
    // FAILED is more honest than a READY document that grounds nothing.
    throw new Error("embed: document has no sections to embed");
  }

  if (pending.length === 0) {
    // Already fully embedded — a retry after the vectors landed but before the
    // status write did. Finish the job rather than re-spending.
    await markReady(schoolId, documentId, totalChunks);
    logger.log(`embed: document ${documentId} was already embedded; marked READY`);
    return { ...NOTHING, chunkCount: totalChunks, skipped: true };
  }

  // ---- 3. plan and embed ------------------------------------------------
  const chunks: Chunk[] = pending.map((row) => ({
    ordinal: row.ordinal,
    heading: row.heading,
    content: row.content,
    tokenCount: row.token_count,
  }));

  const batches = planEmbeddingBatches(chunks);
  const totals = planTotals(batches);
  logger.log(
    `embed: document ${documentId} — ${chunks.length} of ${totalChunks} chunk(s) need vectors, ${totals.requests} request(s)`,
  );

  let embedded = 0;
  let totalTokens = 0;
  let costMicroUsd = 0;

  for (const batch of batches) {
    const outcome = await retryWithBackoff(
      () =>
        embeddings.embed({
          schoolId,
          documentId,
          // Heading INCLUDED (D15) — and note this is now the TEACHER'S
          // heading, not the parser's, which is the entire value of the gate.
          inputs: batch.items.map((c) => embeddableText(c)),
          inputType: "document",
        }),
      {
        ...deps.backoff,
        onRetry: ({ attempt, delayMs, kind }) => {
          logger.warn(
            `embed: document ${documentId} batch ${batch.index + 1}/${batches.length} hit ${kind} on attempt ${attempt}; retrying in ${delayMs}ms`,
          );
          deps.backoff?.onRetry?.({ attempt, delayMs, kind, error: undefined });
        },
      },
    );

    if (outcome.embeddings.length !== batch.items.length) {
      throw new Error(
        `embed: batch ${batch.index} returned ${outcome.embeddings.length} vectors for ${batch.items.length} chunks`,
      );
    }

    // Written per BATCH, not once at the end. That is what makes the
    // NULL-embedding query above a real checkpoint: a crash after batch 12
    // leaves twelve batches' vectors durably stored, and the retry starts at
    // thirteen. Persisting only at the end would make every retry pay for the
    // whole document again.
    const ids = batch.items.map((c) => {
      const row = pending.find((r) => r.ordinal === c.ordinal);
      if (!row) throw new Error(`embed: lost chunk row for ordinal ${c.ordinal}`);
      return row.id;
    });
    await writeVectors(schoolId, ids, outcome.embeddings);

    embedded += batch.items.length;
    totalTokens += outcome.totalTokens;
    costMicroUsd += outcome.costMicroUsd;
  }

  await markReady(schoolId, documentId, totalChunks);

  logger.log(
    `embed: document ${documentId} READY — ${embedded} chunk(s) embedded, ${totalTokens} tokens, ${costMicroUsd} micro-USD`,
  );

  return {
    chunkCount: totalChunks,
    embedded,
    requests: totals.requests,
    totalTokens,
    costMicroUsd,
    skipped: false,
  };
}

/**
 * Mark the document usable.
 *
 * Asserts the invariant D29 moved up to this level rather than trusting it: a
 * document only becomes READY when NO chunk of it is still missing a vector.
 * Retrieval filters on `status = 'READY'`, so if this check were skipped and
 * were ever wrong, a half-embedded document would silently ground lesson plans
 * in whichever fraction of itself happened to be finished.
 */
async function markReady(
  schoolId: string,
  documentId: string,
  chunkCount: number,
): Promise<void> {
  await withTenant(schoolId, async (db) => {
    const [{ remaining }] = await db.$queryRaw<Array<{ remaining: bigint }>>`
      SELECT count(*) AS remaining
      FROM curriculum_chunks
      WHERE document_id = ${documentId}::text
        AND school_id = ${schoolId}::text
        AND embedding IS NULL
    `;
    if (Number(remaining) > 0) {
      throw new Error(
        `embed: refusing to mark document ${documentId} READY — ${remaining} chunk(s) still have no embedding`,
      );
    }
    await db.curriculumDocument.update({
      where: { id: documentId },
      data: { status: "READY", chunkCount, errorMessage: null },
    });
  });
}

/**
 * Attach vectors to chunk rows that already exist.
 *
 * An UPDATE, not an INSERT — the rows were written at upload time and have
 * since been reviewed. One statement per batch via `UPDATE ... FROM (VALUES
 * ...)`, so a 200-chunk batch is one round trip rather than 200 on a database
 * where ~2s authenticated latency is normal.
 *
 * The vector is composed into the SQL literal because pgvector's input syntax
 * is a string like '[0.1,0.2]'. Every value in it is a NUMBER received from the
 * vendor and checked finite below; chunk ids are parameterised. There is no
 * path for document text to reach this string.
 */
async function writeVectors(
  schoolId: string,
  ids: readonly string[],
  vectors: readonly number[][],
): Promise<void> {
  await withTenant(schoolId, async (db) => {
    const rows = ids.map((id, i) => {
      const vector = vectors[i];
      if (!vector) throw new Error(`embed: missing vector for chunk ${id}`);
      return Prisma.sql`(${id}::text, ${toVectorLiteral(vector)}::vector)`;
    });

    await db.$executeRaw`
      UPDATE curriculum_chunks AS c
      SET embedding = v.embedding
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, embedding)
      WHERE c.id = v.id
        AND c.school_id = ${schoolId}::text
    `;
  });
}

function toVectorLiteral(vector: readonly number[]): string {
  for (const v of vector) {
    if (!Number.isFinite(v)) throw new Error("embed: embedding contains a non-finite value");
  }
  return `[${vector.join(",")}]`;
}
