import { ConfigService } from "@nestjs/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, type EmbeddingPort } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";

import { EmbeddingService } from "../../common/embeddings/embedding.service";
import {
  CurriculumRetrievalService,
  RETRIEVAL_MAX_DISTANCE,
  RETRIEVAL_TOP_K,
} from "./curriculum-retrieval.service";

// Phase 7 / CP3 — retrieval, against a REAL Postgres with real pgvector.
//
// The three properties under test are the ones that cannot be checked any
// other way, because each depends on SQL, RLS and the vector operator agreeing:
//
//   1. TENANT ISOLATION. School A must never retrieve school B's chunks. The
//      two schools are given IDENTICAL vectors, so similarity cannot separate
//      them — only RLS and the WHERE clause can. A leak here puts another
//      school's curriculum inside a teacher's lesson plan.
//   2. SUBJECT / CLASS-LEVEL SCOPING (D16). This is a correctness boundary,
//      not relevance: grounding an English plan in a Science scheme is a
//      confident wrong answer.
//   3. THE DISTANCE FLOOR (D17). Cosine distance always returns a nearest
//      neighbour, so without a floor an irrelevant corpus grounds everything.
//
// Vectors are constructed by hand rather than fetched from Voyage: the floor
// and the scoping are properties of OUR code, and a live vendor call would make
// this suite slow, costly and non-deterministic for no added confidence. The
// live half is packages/ai/evals — and the floor itself was set from real
// Voyage measurements (see RETRIEVAL_MAX_DISTANCE).

const runId = Math.random().toString(36).slice(2, 8);

/**
 * A unit vector pointing along one axis. Two such vectors are orthogonal
 * (cosine distance exactly 1.0) unless they share an axis, which makes the
 * distances in this suite exact rather than approximate.
 */
function axis(i: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) => (k === i ? 1 : 0));
}

/** A vector at a chosen cosine distance from `axis(0)`, for floor testing. */
function nearAxis0(distance: number): number[] {
  // cos(theta) = 1 - distance; place the vector in the (0,1) plane.
  const cos = 1 - distance;
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, k) =>
    k === 0 ? cos : k === 1 ? sin : 0,
  );
}

/** An embedding port that always returns the vector it was constructed with. */
function portReturning(vector: number[]): EmbeddingPort {
  return {
    async embed(req) {
      return { embeddings: req.inputs.map(() => vector), totalTokens: 5, model: req.model };
    },
  };
}

const configStub = { get: () => undefined } as unknown as ConfigService;

function serviceWithQueryVector(vector: number[]): CurriculumRetrievalService {
  return new CurriculumRetrievalService(new EmbeddingService(configStub, portReturning(vector)));
}

describe("CurriculumRetrievalService — against real Postgres + pgvector", () => {
  let schoolA: string;
  let schoolB: string;
  const SUBJECT_ENGLISH = `subj-eng-${runId}`;
  const SUBJECT_SCIENCE = `subj-sci-${runId}`;
  const LEVEL_JSS3 = `lvl-jss3-${runId}`;
  const LEVEL_JSS2 = `lvl-jss2-${runId}`;

  async function makeDocument(
    schoolId: string,
    opts: { subjectId: string; classLevelId: string; title: string; status?: string },
  ): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId,
          subjectId: opts.subjectId,
          classLevelId: opts.classLevelId,
          title: opts.title,
          storageKey: `curriculum/${opts.title}-${Math.random()}`,
          checksum: `sum-${opts.title}-${Math.random()}`,
          uploadedBy: `uploader-${runId}`,
          status: (opts.status ?? "READY") as "READY",
        },
        select: { id: true },
      });
      return doc.id;
    });
  }

  async function makeChunk(
    schoolId: string,
    documentId: string,
    opts: { ordinal: number; heading: string; content: string; vector: number[] },
  ): Promise<void> {
    await withTenant(schoolId, (db) =>
      db.$executeRawUnsafe(
        `INSERT INTO curriculum_chunks
           (id, school_id, document_id, ordinal, heading, content, token_count, embedding, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 10, $6::vector, now())`,
        schoolId,
        documentId,
        opts.ordinal,
        opts.heading,
        opts.content,
        `[${opts.vector.join(",")}]`,
      ),
    );
  }

  beforeAll(async () => {
    const a = await basePrisma.school.create({
      data: { name: "Retrieval A", slug: `ret-a-${runId}` },
      select: { id: true },
    });
    const b = await basePrisma.school.create({
      data: { name: "Retrieval B", slug: `ret-b-${runId}` },
      select: { id: true },
    });
    schoolA = a.id;
    schoolB = b.id;

    // School A: English JSS3 — the target corpus.
    const engA = await makeDocument(schoolA, {
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      title: "English JSS3 Scheme",
    });
    await makeChunk(schoolA, engA, {
      ordinal: 0,
      heading: "First Term > WEEK 3",
      content: "Adverbs of frequency — often, always, occasionally.",
      vector: axis(0),
    });
    await makeChunk(schoolA, engA, {
      ordinal: 1,
      heading: "First Term > WEEK 8",
      content: "Consonants sheep/chip and fish/pitch.",
      vector: nearAxis0(0.3),
    });

    // School A: Science JSS3 — same school and level, DIFFERENT subject, and
    // deliberately given the IDENTICAL vector to the English week-3 chunk so
    // that only the subject filter can exclude it.
    const sciA = await makeDocument(schoolA, {
      subjectId: SUBJECT_SCIENCE,
      classLevelId: LEVEL_JSS3,
      title: "Basic Science JSS3 Scheme",
    });
    await makeChunk(schoolA, sciA, {
      ordinal: 0,
      heading: "First Term > WEEK 3",
      content: "Photosynthesis and the role of chlorophyll.",
      vector: axis(0),
    });

    // School A: English JSS2 — same school and subject, DIFFERENT class level,
    // identical vector again.
    const engA2 = await makeDocument(schoolA, {
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS2,
      title: "English JSS2 Scheme",
    });
    await makeChunk(schoolA, engA2, {
      ordinal: 0,
      heading: "First Term > WEEK 3",
      content: "JSS2 content that must not reach a JSS3 plan.",
      vector: axis(0),
    });

    // School B: same subject, same level, IDENTICAL vector. Only RLS and the
    // school_id predicate stand between school A's query and this row.
    const engB = await makeDocument(schoolB, {
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      title: "Another School's English Scheme",
    });
    await makeChunk(schoolB, engB, {
      ordinal: 0,
      heading: "First Term > WEEK 3",
      content: "ANOTHER SCHOOL'S CURRICULUM — must never be retrieved.",
      vector: axis(0),
    });
  });

  afterAll(async () => {
    for (const s of [schoolA, schoolB]) {
      await withTenant(s, (db) => db.curriculumChunk.deleteMany({ where: { schoolId: s } }));
      await withTenant(s, (db) => db.embeddingGeneration.deleteMany({ where: { schoolId: s } }));
      await withTenant(s, (db) => db.curriculumDocument.deleteMany({ where: { schoolId: s } }));
      await withTenant(s, (db) => db.aIBudgetPeriod.deleteMany({ where: { schoolId: s } }));
    }
    await basePrisma.school.deleteMany({ where: { id: { in: [schoolA, schoolB] } } });
    await basePrisma.$disconnect();
  });

  it("retrieves the school's own chunks, nearest first", async () => {
    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });

    expect(result.reason).toBe("ok");
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0]!.heading).toBe("First Term > WEEK 3");
    expect(result.chunks[0]!.distance).toBeCloseTo(0, 5);
    expect(result.chunks[0]!.documentTitle).toBe("English JSS3 Scheme");
    // Ordered by distance.
    const distances = result.chunks.map((c) => c.distance);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
  });

  it("NEVER returns another school's chunks, even with an identical vector", async () => {
    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });

    const leaked = result.chunks.filter((c) => c.content.includes("ANOTHER SCHOOL'S"));
    expect(leaked).toHaveLength(0);
    expect(result.chunks.every((c) => c.documentTitle === "English JSS3 Scheme")).toBe(true);
  });

  it("EXCLUDES another subject at the same school and level (D16)", async () => {
    // The science chunk has the IDENTICAL vector, so similarity cannot
    // separate it — only the subject filter can. Grounding an English plan in
    // a science scheme is a confident wrong answer.
    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });

    expect(result.chunks.some((c) => /Photosynthesis/i.test(c.content))).toBe(false);
  });

  it("EXCLUDES another class level at the same school and subject", async () => {
    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });

    expect(result.chunks.some((c) => /JSS2 content/i.test(c.content))).toBe(false);
  });

  it("REJECTS everything when nothing clears the distance floor (D17)", async () => {
    // An orthogonal query: cosine distance 1.0 to every chunk. Postgres will
    // still happily return a nearest neighbour — the floor is the only thing
    // that stops a Mathematics-only corpus grounding an English lesson.
    const svc = serviceWithQueryVector(axis(500));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "solving quadratic equations",
    });

    expect(result.reason).toBe("no-match");
    expect(result.chunks).toHaveLength(0);
    // The rejected nearest distance is still reported — this is CP4's tuning data.
    expect(result.nearestDistance).not.toBeNull();
    expect(result.nearestDistance!).toBeGreaterThan(RETRIEVAL_MAX_DISTANCE);
  });

  it("accepts a chunk just INSIDE the floor and rejects one just outside", async () => {
    // A dedicated single-chunk corpus. The main English corpus holds two
    // chunks in the same plane, so a query placed just outside the floor from
    // ONE of them lands well inside it from the other — which is correct
    // behaviour and makes that corpus useless for testing the boundary itself.
    const subjectId = `subj-boundary-${runId}`;
    const doc = await makeDocument(schoolA, {
      subjectId,
      classLevelId: LEVEL_JSS3,
      title: "Boundary corpus",
    });
    await makeChunk(schoolA, doc, {
      ordinal: 0,
      heading: "First Term > WEEK 1",
      content: "The only chunk in this corpus.",
      vector: axis(0),
    });

    const args = { schoolId: schoolA, subjectId, classLevelId: LEVEL_JSS3, query: "boundary" };
    const inside = serviceWithQueryVector(nearAxis0(RETRIEVAL_MAX_DISTANCE - 0.05));
    const outside = serviceWithQueryVector(nearAxis0(RETRIEVAL_MAX_DISTANCE + 0.05));

    const kept = await inside.retrieve(args);
    expect(kept.reason).toBe("ok");
    expect(kept.chunks[0]!.distance).toBeLessThanOrEqual(RETRIEVAL_MAX_DISTANCE);

    const rejected = await outside.retrieve(args);
    expect(rejected.reason).toBe("no-match");
    expect(rejected.nearestDistance!).toBeGreaterThan(RETRIEVAL_MAX_DISTANCE);
  });

  it("caps results at TOP_K", async () => {
    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs",
    });
    expect(result.chunks.length).toBeLessThanOrEqual(RETRIEVAL_TOP_K);
  });

  it("returns no-documents WITHOUT calling the vendor when the school has none", async () => {
    // The common case for every school that has not uploaded anything. Paying
    // for a query embedding to search an empty set would be a per-generation
    // cost with no possible result.
    let called = false;
    const port: EmbeddingPort = {
      async embed(req) {
        called = true;
        return { embeddings: req.inputs.map(() => axis(0)), totalTokens: 1, model: req.model };
      },
    };
    const svc = new CurriculumRetrievalService(new EmbeddingService(configStub, port));

    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: `subject-with-nothing-${runId}`,
      classLevelId: LEVEL_JSS3,
      query: "anything",
    });

    expect(result.reason).toBe("no-documents");
    expect(called).toBe(false);
  });

  it("ignores documents that are not READY", async () => {
    const pending = await makeDocument(schoolA, {
      subjectId: `subj-pending-${runId}`,
      classLevelId: LEVEL_JSS3,
      title: "Still processing",
      status: "PROCESSING",
    });
    await makeChunk(schoolA, pending, {
      ordinal: 0,
      heading: "First Term > WEEK 1",
      content: "Half-ingested content.",
      vector: axis(0),
    });

    const svc = serviceWithQueryVector(axis(0));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: `subj-pending-${runId}`,
      classLevelId: LEVEL_JSS3,
      query: "anything",
    });
    expect(result.reason).toBe("no-documents");
  });

  it("DEGRADES rather than throwing when the embedding call fails (D18)", async () => {
    // A teacher must not lose their lesson plan because a second vendor had a
    // bad minute.
    const failing: EmbeddingPort = {
      async embed() {
        throw new Error("Voyage embeddings request failed: 503 Service Unavailable");
      },
    };
    const svc = new CurriculumRetrievalService(new EmbeddingService(configStub, failing));

    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });

    expect(result.reason).toBe("error");
    expect(result.chunks).toHaveLength(0);
  });

  it("reports not-configured without touching the database", async () => {
    const svc = new CurriculumRetrievalService(new EmbeddingService(configStub));
    const result = await svc.retrieve({
      schoolId: schoolA,
      subjectId: SUBJECT_ENGLISH,
      classLevelId: LEVEL_JSS3,
      query: "adverbs of frequency",
    });
    expect(result.reason).toBe("not-configured");
    expect(result.chunks).toHaveLength(0);
  });
});
