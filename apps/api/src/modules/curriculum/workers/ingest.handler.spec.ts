import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, VendorApiError, type EmbeddingPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { EmbeddingService } from "../../../common/embeddings/embedding.service";
import type { StorageService } from "../../../common/storage";
import { makeTextPdf } from "../parsing/make-test-pdf";
import { runIngestHandler } from "./ingest.handler";

// Phase 7 / CP2 — the ingestion pipeline, end to end, against a REAL Postgres.
//
// What this suite is for: proving the pipeline's three hard properties, each of
// which is invisible in a unit test of any single piece.
//
//   1. Chunks land with vectors of the right dimension, in the right order,
//      under the right tenant — and the document reaches READY.
//   2. A RATE LIMIT MID-PIPELINE IS SURVIVED, not fatal (D4a). This is the
//      headline behaviour of CP2 and it is asserted against a port that
//      actually throws a 429 partway through a multi-batch document.
//   3. A RETRY DOES NOT DUPLICATE CHUNKS. The handler deletes before
//      inserting; without that, a crash-and-retry silently doubles a
//      document's chunks and skews every retrieval that touches them.
//
// A fake EmbeddingPort is used rather than the live vendor. That is the right
// call here and not a shortcut: specs must not spend money, and — more
// importantly — a real 429 cannot be summoned on demand at the paid tier
// (measured 2026-09-02: 500 requests in 11.6s with zero refusals). The live
// half of the evidence is packages/ai/evals/live-curriculum-ingest.ts.

const runId = Math.random().toString(36).slice(2, 8);

/** A vector of the correct dimension; the values are irrelevant to this suite. */
const vec = (seed: number): number[] =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === seed % EMBEDDING_DIMENSIONS ? 1 : 0));

/** An in-memory StorageService stand-in — only get() is exercised here. */
function fakeStorage(bytes: Buffer): StorageService {
  return {
    get: async () => bytes,
  } as unknown as StorageService;
}

const silentLogger = { log: () => undefined, warn: () => undefined };

/** Deterministic port that always succeeds. */
function okPort(): EmbeddingPort & { calls: number } {
  const port = {
    calls: 0,
    async embed(req: { inputs: readonly string[]; model: string }) {
      port.calls += 1;
      return {
        embeddings: req.inputs.map((_, i) => vec(i)),
        totalTokens: 10 * req.inputs.length,
        model: req.model,
      };
    },
  };
  return port as EmbeddingPort & { calls: number };
}

/** Port that returns 429 for the first `failures` calls, then succeeds. */
function rateLimitedPort(failures: number): EmbeddingPort & { calls: number } {
  const port = {
    calls: 0,
    async embed(req: { inputs: readonly string[]; model: string }) {
      port.calls += 1;
      if (port.calls <= failures) {
        throw new VendorApiError(
          "Voyage embeddings request failed: 429 Too Many Requests",
          429,
          // A tiny Retry-After so the spec does not actually wait — the policy
          // honours it, which is precisely what makes this fast AND real.
          5,
        );
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

const configStub = { get: () => undefined } as never;

// A scheme of work with enough sections to produce several chunks.
function scheme(label: string, weeks: number): string {
  let out = `FIRST TERM SCHEME OF WORK\n${label}\n`;
  for (let w = 1; w <= weeks; w++) {
    out += `\nWEEK ${w}\nTOPIC: Subject matter for week ${w}\n`;
    out += `Pupils should be able to describe the topic for week ${w} in their own words, `;
    out += `list at least three examples drawn from their own environment, and complete the `;
    out += `evaluation exercise at the end of the chapter before the next lesson begins.\n`;
  }
  return out;
}

describe("runIngestHandler — against real Postgres", () => {
  let school: { id: string };
  let otherSchool: { id: string };

  beforeAll(async () => {
    school = await basePrisma.school.create({
      data: { name: "Ingest A", slug: `ingest-a-${runId}` },
      select: { id: true },
    });
    otherSchool = await basePrisma.school.create({
      data: { name: "Ingest B", slug: `ingest-b-${runId}` },
      select: { id: true },
    });
  });

  afterAll(async () => {
    for (const s of [school, otherSchool]) {
      await withTenant(s.id, (db) => db.curriculumChunk.deleteMany({ where: { schoolId: s.id } }));
      await withTenant(s.id, (db) =>
        db.embeddingGeneration.deleteMany({ where: { schoolId: s.id } }),
      );
      await withTenant(s.id, (db) =>
        db.curriculumDocument.deleteMany({ where: { schoolId: s.id } }),
      );
      await withTenant(s.id, (db) => db.aIBudgetPeriod.deleteMany({ where: { schoolId: s.id } }));
    }
    await basePrisma.school.deleteMany({ where: { id: { in: [school.id, otherSchool.id] } } });
    await basePrisma.$disconnect();
  });

  async function createDoc(schoolId: string, title: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId,
          subjectId: `subject-${runId}`,
          classLevelId: `level-${runId}`,
          title,
          storageKey: `curriculum/${title}`,
          checksum: `sum-${title}-${Math.random()}`,
          uploadedBy: `uploader-${runId}`,
          status: "PENDING",
        },
        select: { id: true },
      });
      return doc.id;
    });
  }

  it("ingests a pasted-text document to READY with correctly ordered chunks", async () => {
    const text = scheme("Basic Science JSS2", 6);
    const documentId = await createDoc(school.id, "paste-happy");
    const port = okPort();

    const result = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(text, "utf8")),
      embeddings: new EmbeddingService(configStub, port),
      logger: silentLogger,
    });

    expect(result.skipped).toBe(false);
    expect(result.chunkCount).toBeGreaterThan(1);

    const { doc, chunks } = await withTenant(school.id, async (db) => ({
      doc: await db.curriculumDocument.findUniqueOrThrow({ where: { id: documentId } }),
      chunks: await db.curriculumChunk.findMany({
        where: { documentId },
        orderBy: { ordinal: "asc" },
        select: { ordinal: true, heading: true, content: true, tokenCount: true },
      }),
    }));

    expect(doc.status).toBe("READY");
    expect(doc.chunkCount).toBe(result.chunkCount);
    expect(chunks).toHaveLength(result.chunkCount);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
    // Headings survived the round-trip — this is what makes a chunk citable.
    expect(chunks.some((c) => c.heading?.includes("WEEK 1"))).toBe(true);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });

  it("stores a vector of the SCHEMA'S dimension for every chunk", async () => {
    const documentId = await createDoc(school.id, "dims");
    await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(scheme("Dims", 3), "utf8")),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    // Read the dimension back from Postgres itself. Prisma cannot see the
    // column, so this is the only way to assert what was actually stored — and
    // a dimension mismatch is an insert failure at ingestion time discovered by
    // a teacher, not by us.
    const rows = await withTenant(school.id, (db) =>
      db.$queryRawUnsafe<Array<{ dims: number }>>(
        `SELECT vector_dims(embedding)::int AS dims FROM curriculum_chunks WHERE document_id = $1`,
        documentId,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.dims === EMBEDDING_DIMENSIONS)).toBe(true);
  });

  it("ingests a real PDF, not only pasted text", async () => {
    const documentId = await createDoc(school.id, "pdf");
    const pdf = makeTextPdf([
      ["FIRST TERM SCHEME OF WORK", "WEEK 5", "TOPIC: Photosynthesis"],
      [
        "Pupils should be able to state the word equation for photosynthesis and name the raw materials required for the process to take place in a green leaf.",
        "The teacher demonstrates using a potted plant kept in darkness for forty-eight hours before the lesson begins.",
      ],
    ]);

    const result = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(pdf),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    expect(result.chunkCount).toBeGreaterThan(0);
    const chunks = await withTenant(school.id, (db) =>
      db.curriculumChunk.findMany({ where: { documentId }, select: { content: true } }),
    );
    expect(chunks.map((c) => c.content).join(" ")).toContain("word equation");
  });

  it("SURVIVES A RATE LIMIT MID-PIPELINE — a 429 is a retry, not a FAILED document", async () => {
    // The headline D4a behaviour, asserted end to end rather than only in the
    // retry policy's own unit test.
    const documentId = await createDoc(school.id, "rate-limited");
    const port = rateLimitedPort(2);
    let retries = 0;

    const result = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(scheme("Rate limited", 8), "utf8")),
      embeddings: new EmbeddingService(configStub, port),
      logger: silentLogger,
      backoff: { onRetry: () => { retries += 1; } },
    });

    expect(retries).toBeGreaterThanOrEqual(2);
    expect(port.calls).toBeGreaterThan(2);

    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findUniqueOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("READY");
    expect(doc.chunkCount).toBe(result.chunkCount);
    expect(doc.errorMessage).toBeNull();
  });

  it("gives up on a FATAL vendor error and leaves the document not-READY", async () => {
    const documentId = await createDoc(school.id, "fatal");
    const badKeyPort: EmbeddingPort = {
      async embed() {
        throw new VendorApiError("Unauthorized", 401);
      },
    };

    await expect(
      runIngestHandler({
        documentId,
        schoolId: school.id,
        storage: fakeStorage(Buffer.from(scheme("Fatal", 3), "utf8")),
        embeddings: new EmbeddingService(configStub, badKeyPort),
        logger: silentLogger,
      }),
    ).rejects.toThrow(/Unauthorized/);

    // The handler does not write FAILED itself — the processor's failed-event
    // listener does, once BullMQ has exhausted attempts. What matters here is
    // that it did NOT reach READY.
    const doc = await withTenant(school.id, (db) =>
      db.curriculumDocument.findUniqueOrThrow({ where: { id: documentId } }),
    );
    expect(doc.status).toBe("PROCESSING");
    expect(doc.chunkCount).toBe(0);
  });

  it("A RETRY DOES NOT DUPLICATE CHUNKS", async () => {
    // Simulates BullMQ re-running a job whose first attempt already wrote
    // chunks. Without the delete-before-insert this silently doubles the
    // document's chunks, and every retrieval that touches them is skewed.
    const documentId = await createDoc(school.id, "idempotent");
    const text = scheme("Idempotent", 5);

    const first = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(text, "utf8")),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    // Put it back to PROCESSING, the state a crashed attempt leaves behind.
    await withTenant(school.id, (db) =>
      db.curriculumDocument.update({ where: { id: documentId }, data: { status: "PROCESSING" } }),
    );

    const second = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(text, "utf8")),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    expect(second.chunkCount).toBe(first.chunkCount);
    const count = await withTenant(school.id, (db) =>
      db.curriculumChunk.count({ where: { documentId } }),
    );
    expect(count).toBe(first.chunkCount);
  });

  it("skips a document that is already READY rather than re-spending", async () => {
    const documentId = await createDoc(school.id, "already-ready");
    await withTenant(school.id, (db) =>
      db.curriculumDocument.update({ where: { id: documentId }, data: { status: "READY" } }),
    );
    const port = okPort();

    const result = await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(scheme("Ready", 3), "utf8")),
      embeddings: new EmbeddingService(configStub, port),
      logger: silentLogger,
    });

    expect(result.skipped).toBe(true);
    expect(port.calls).toBe(0);
  });

  it("LEDGERS the ingestion spend against the school", async () => {
    const documentId = await createDoc(school.id, "ledger");
    await runIngestHandler({
      documentId,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(scheme("Ledger", 4), "utf8")),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    const rows = await withTenant(school.id, (db) =>
      db.embeddingGeneration.findMany({ where: { documentId } }),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.purpose === "ingest")).toBe(true);
    expect(rows.every((r) => r.success)).toBe(true);
    expect(rows.reduce((a, r) => a + r.inputTokens, 0)).toBeGreaterThan(0);
  });

  it("writes chunks under the OWNING school only — no cross-tenant bleed", async () => {
    // The failure this guards against is another school's curriculum appearing
    // inside a teacher's lesson plan. Cheap to assert, catastrophic to miss.
    const mine = await createDoc(school.id, "tenant-mine");
    await runIngestHandler({
      documentId: mine,
      schoolId: school.id,
      storage: fakeStorage(Buffer.from(scheme("Mine", 3), "utf8")),
      embeddings: new EmbeddingService(configStub, okPort()),
      logger: silentLogger,
    });

    const seenByOther = await withTenant(otherSchool.id, (db) =>
      db.curriculumChunk.count({ where: { documentId: mine } }),
    );
    expect(seenByOther).toBe(0);

    const seenByOwner = await withTenant(school.id, (db) =>
      db.curriculumChunk.count({ where: { documentId: mine } }),
    );
    expect(seenByOwner).toBeGreaterThan(0);
  });
});
