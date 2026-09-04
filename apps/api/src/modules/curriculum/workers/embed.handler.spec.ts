import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, VendorApiError, type EmbeddingPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { EmbeddingService } from "../../../common/embeddings/embedding.service";
import { runEmbedHandler } from "./embed.handler";

// Phase 7 / CP5 — the embed handler, against a REAL Postgres.
//
// THE CENTRAL ASSERTION OF THIS WHOLE CHECKPOINT is the first test below:
// what gets embedded is the TEACHER'S CORRECTED HEADING, not the parser's
// original.
//
// It deserves its own spec because the failure it guards against is silent and
// total. The review screen could work perfectly — the teacher fixes a wrong
// heading, the row updates, the UI shows the correction, the document goes
// READY — and if the embed step re-derived its chunks from the stored source
// file (which is exactly what the PRE-CP5 handler did, deliberately and for
// good reasons at the time), every correction would be discarded at the last
// moment and the parser's mistakes embedded anyway. Nothing else in the system
// would notice: the chunk rows would still show the corrected text, only the
// vectors would disagree with them.
//
// A fake EmbeddingPort is used rather than the live vendor, for the same
// reasons the CP2 ingest spec gives: specs must not spend money, and a real 429
// cannot be summoned on demand at the paid tier.

const runId = Math.random().toString(36).slice(2, 8);

const vec = (seed: number): number[] =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed % EMBEDDING_DIMENSIONS ? 1 : 0));

const silentLogger = { log: () => undefined, warn: () => undefined };
const configStub = { get: () => undefined } as never;

/** Records every input string it is asked to embed, so they can be asserted. */
function recordingPort(): EmbeddingPort & { seen: string[]; calls: number } {
  const port = {
    seen: [] as string[],
    calls: 0,
    async embed(req: { inputs: readonly string[]; model: string }) {
      port.calls += 1;
      port.seen.push(...req.inputs);
      return {
        embeddings: req.inputs.map((_, i) => vec(i)),
        totalTokens: 10 * req.inputs.length,
        model: req.model,
      };
    },
  };
  return port as EmbeddingPort & { seen: string[]; calls: number };
}

/** Fails the first `failures` calls with a 429, then succeeds. */
function flakyPort(failures: number): EmbeddingPort & { calls: number } {
  const port = {
    calls: 0,
    async embed(req: { inputs: readonly string[]; model: string }) {
      port.calls += 1;
      if (port.calls <= failures) {
        throw new VendorApiError("Voyage embeddings request failed: 429", 429, 5);
      }
      return {
        embeddings: req.inputs.map((_, i) => vec(i)),
        totalTokens: 10 * req.inputs.length,
        model: req.model,
      };
    },
  };
  return port as EmbeddingPort & { calls: number };
}

describe("runEmbedHandler — the review gate's second half", () => {
  let school: { id: string };

  async function makeApprovedDocument(
    title: string,
    headings: readonly (string | null)[],
  ): Promise<string> {
    return withTenant(school.id, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId: school.id,
          subjectId: `subject-${runId}`,
          classLevelId: `level-${runId}`,
          title,
          storageKey: `curriculum/${title}`,
          checksum: `sum-${title}-${Math.random()}`,
          uploadedBy: `user-${runId}`,
          // Where `approve` leaves a document.
          status: "EMBEDDING",
          chunkCount: headings.length,
          reviewedBy: `user-${runId}`,
          reviewedAt: new Date(),
        },
        select: { id: true },
      });
      for (const [i, heading] of headings.entries()) {
        await db.curriculumChunk.create({
          data: {
            schoolId: school.id,
            documentId: doc.id,
            ordinal: i,
            heading,
            content: `Body text for section ${i}.`,
            tokenCount: 12,
          },
        });
      }
      return doc.id;
    });
  }

  function countMissingVectors(documentId: string): Promise<number> {
    return withTenant(school.id, async (db) => {
      const rows = await db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM curriculum_chunks
        WHERE document_id = ${documentId}::text AND embedding IS NULL
      `;
      return Number(rows[0]!.n);
    });
  }

  beforeAll(async () => {
    school = await basePrisma.school.create({
      data: { name: "Embed CP5", slug: `embed-cp5-${runId}` },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await withTenant(school.id, (db) =>
      db.curriculumChunk.deleteMany({ where: { schoolId: school.id } }),
    );
    await withTenant(school.id, (db) =>
      db.embeddingGeneration.deleteMany({ where: { schoolId: school.id } }),
    );
    await withTenant(school.id, (db) =>
      db.curriculumDocument.deleteMany({ where: { schoolId: school.id } }),
    );
    await basePrisma.school.delete({ where: { id: school.id } });
    await basePrisma.$disconnect();
  });

  it("embeds the TEACHER'S corrected heading, not the parser's original", async () => {
    // The parser produced "ENGLISH" — a real defect seen on a real document,
    // where a running column label was promoted to a heading eight times over.
    // The teacher corrected it in review. This is the whole point of CP5.
    const corrected = "First Term > WEEK 3 > Adverbs of Frequency";
    const documentId = await makeApprovedDocument("corrected-heading", [corrected]);

    const port = recordingPort();
    const embeddings = new EmbeddingService(configStub, port);

    await runEmbedHandler({
      documentId,
      schoolId: school.id,
      embeddings,
      logger: silentLogger,
      backoff: { baseDelayMs: 1, maxDelayMs: 2 },
    });

    expect(port.seen).toHaveLength(1);
    // embeddableText prepends the heading (D15), so the corrected heading must
    // literally appear in what was sent to the vendor.
    expect(port.seen[0]).toContain(corrected);
    expect(port.seen[0]).not.toContain("ENGLISH");

    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findFirstOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("READY");
    // The approval survives the embed — a teacher does not re-approve because
    // the machine did its half.
    expect(doc.reviewedAt).not.toBeNull();
    expect(await countMissingVectors(documentId)).toBe(0);
  });

  it("refuses to touch a document that has NOT been approved", async () => {
    const documentId = await makeApprovedDocument("not-approved", ["First Term > WEEK 1"]);
    await withTenant(school.id, (db) =>
      db.curriculumDocument.update({
        where: { id: documentId },
        data: { status: "AWAITING_REVIEW" },
      }),
    );

    const port = recordingPort();
    const result = await runEmbedHandler({
      documentId,
      schoolId: school.id,
      embeddings: new EmbeddingService(configStub, port),
      logger: silentLogger,
      backoff: { baseDelayMs: 1, maxDelayMs: 2 },
    });

    // The gate expressed as a state machine: no approval, no embedding, no
    // spend — and critically the document does NOT become usable.
    expect(result.skipped).toBe(true);
    expect(port.calls).toBe(0);
    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findFirstOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("AWAITING_REVIEW");
    expect(await countMissingVectors(documentId)).toBe(1);
  });

  it("resumes rather than re-embedding: a retry only pays for what is still missing", async () => {
    const documentId = await makeApprovedDocument("resume", [
      "First Term > WEEK 1",
      "First Term > WEEK 2",
    ]);

    // First run succeeds.
    const first = recordingPort();
    await runEmbedHandler({
      documentId,
      schoolId: school.id,
      embeddings: new EmbeddingService(configStub, first),
      logger: silentLogger,
      backoff: { baseDelayMs: 1, maxDelayMs: 2 },
    });
    expect(first.seen).toHaveLength(2);

    // A retry after the status write is lost. The NULL-embedding query is the
    // checkpoint, so nothing is re-sent to the vendor.
    await withTenant(school.id, (db) =>
      db.curriculumDocument.update({
        where: { id: documentId },
        data: { status: "EMBEDDING" },
      }),
    );
    const second = recordingPort();
    const result = await runEmbedHandler({
      documentId,
      schoolId: school.id,
      embeddings: new EmbeddingService(configStub, second),
      logger: silentLogger,
      backoff: { baseDelayMs: 1, maxDelayMs: 2 },
    });

    expect(second.calls).toBe(0);
    expect(result.skipped).toBe(true);
    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findFirstOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("READY");
  });

  it("survives a rate limit mid-document (D4a still holds after the split)", async () => {
    const documentId = await makeApprovedDocument("rate-limited", ["First Term > WEEK 1"]);

    const port = flakyPort(2);
    await runEmbedHandler({
      documentId,
      schoolId: school.id,
      embeddings: new EmbeddingService(configStub, port),
      logger: silentLogger,
      backoff: { baseDelayMs: 1, maxDelayMs: 2 },
    });

    expect(port.calls).toBe(3);
    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findFirstOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("READY");
  });

  it("a chunk with no vector is invisible to retrieval even if the document says READY", async () => {
    // Defends D29's belt-and-braces guard directly. The status filter alone
    // would let this row through, and the row has no vector to compare against.
    const documentId = await makeApprovedDocument("half-embedded", [
      "First Term > WEEK 1",
      "First Term > WEEK 2",
    ]);
    await withTenant(school.id, (db) =>
      db.curriculumDocument.update({ where: { id: documentId }, data: { status: "READY" } }),
    );

    const rows = await withTenant(school.id, (db) =>
      db.$queryRaw<Array<{ id: string }>>`
        SELECT c.id FROM curriculum_chunks c
        JOIN curriculum_documents d ON d.id = c.document_id AND d.school_id = c.school_id
        WHERE c.school_id = ${school.id}::text
          AND d.status = 'READY'
          AND c.embedding IS NOT NULL
          AND c.document_id = ${documentId}::text
      `,
    );
    expect(rows).toHaveLength(0);
  });
});
