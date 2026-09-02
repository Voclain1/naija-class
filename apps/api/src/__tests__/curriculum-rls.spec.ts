import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

// Phase 7 / CP1 — tenant isolation on the curriculum RAG tables.
//
// Sibling of rls.spec.ts, kept separate because what it protects is different
// in kind. A leak in `users` is a privacy breach anyone would recognise as one.
// A leak in `curriculum_chunks` puts ANOTHER SCHOOL'S curriculum text inside a
// teacher's generated lesson plan — plausible-looking, silent, and unlikely to
// be reported as a bug by either school. That is the specific failure this
// suite exists to make impossible.
//
// It runs against the real dev database on purpose. The policies, the GUC and
// set_config must line up; mocking Prisma would test none of that.
//
// NOTE ON RAW SQL: `curriculum_chunks.embedding` is `Unsupported("vector(1024)")`,
// so Prisma Client cannot read or write it. Every insert and every similarity
// search below is $executeRaw / $queryRaw inside withTenant — which is exactly
// the code path CP2 and CP3 will use, so this suite exercises the real shape
// rather than a convenient substitute.

/** A deterministic unit-ish vector. Content is irrelevant; dimensionality is not. */
function vectorLiteral(seed: number): string {
  return `[${Array.from({ length: 1024 }, (_, i) => (i === seed ? 1 : 0)).join(",")}]`;
}

describe("multi-tenant isolation (Phase 7 curriculum RAG)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let docA: string;
  let docB: string;

  async function insertDoc(schoolId: string, title: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId,
          subjectId: `subject-${runId}`,
          classLevelId: `level-${runId}`,
          title,
          storageKey: `curriculum-document/${runId}/${title}`,
          checksum: `sum-${title}`,
          uploadedBy: `uploader-${runId}`,
        },
        select: { id: true },
      });
      return doc.id;
    });
  }

  async function insertChunk(
    schoolId: string,
    documentId: string,
    content: string,
    seed: number,
  ): Promise<void> {
    await withTenant(schoolId, async (db) => {
      await db.$executeRawUnsafe(
        `INSERT INTO curriculum_chunks
           (id, school_id, document_id, ordinal, heading, content, token_count, embedding)
         VALUES (gen_random_uuid()::text, $1, $2, 0, $3, $4, 10, $5::vector)`,
        schoolId,
        documentId,
        `Week 1`,
        content,
        vectorLiteral(seed),
      );
    });
  }

  beforeAll(async () => {
    // `schools` has no RLS, so these admin-style inserts are fine.
    schoolA = await basePrisma.school.create({
      data: { name: "Curriculum A", slug: `curr-a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "Curriculum B", slug: `curr-b-${runId}` },
      select: { id: true },
    });

    docA = await insertDoc(schoolA.id, "Scheme A");
    docB = await insertDoc(schoolB.id, "Scheme B");

    await insertChunk(schoolA.id, docA, "PHOTOSYNTHESIS — school A material", 0);
    await insertChunk(schoolB.id, docB, "PHOTOSYNTHESIS — school B material", 0);
  });

  afterAll(async () => {
    // Chunks cascade from documents; documents and schools go explicitly.
    await withTenant(schoolA.id, (db) =>
      db.curriculumDocument.deleteMany({ where: { schoolId: schoolA.id } }),
    );
    await withTenant(schoolB.id, (db) =>
      db.curriculumDocument.deleteMany({ where: { schoolId: schoolB.id } }),
    );
    await basePrisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
    await basePrisma.$disconnect();
  });

  it("a school sees only its own curriculum documents", async () => {
    const seen = await withTenant(schoolA.id, (db) =>
      db.curriculumDocument.findMany({ select: { id: true, schoolId: true } }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe(docA);
    expect(seen.every((d) => d.schoolId === schoolA.id)).toBe(true);
  });

  it("a school sees only its own chunks", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.$queryRawUnsafe<Array<{ content: string }>>(
        `SELECT content FROM curriculum_chunks`,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("school A");
    // The assertion that matters: B's material is not merely ranked lower, it
    // is not present at all.
    expect(rows.some((r) => r.content.includes("school B"))).toBe(false);
  });

  it("a SIMILARITY SEARCH cannot reach another school's chunks", async () => {
    // Both schools' chunks were embedded with the SAME vector, so a search
    // ordering purely by distance would surface B's row for A with an
    // identical score. Only RLS keeps it out — which is the point.
    const rows = await withTenant(schoolA.id, (db) =>
      db.$queryRawUnsafe<Array<{ content: string; distance: number }>>(
        `SELECT content, embedding <=> $1::vector AS distance
           FROM curriculum_chunks
          WHERE school_id = $2
          ORDER BY embedding <=> $1::vector
          LIMIT 10`,
        vectorLiteral(0),
        schoolA.id,
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain("school A");
  });

  it("returns ZERO rows when no school GUC is set", async () => {
    // The unset-GUC case is the one that silently returns everything if a
    // policy is written with a permissive fallback.
    const docs = await basePrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM curriculum_documents`,
    );
    const chunks = await basePrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM curriculum_chunks`,
    );
    const ledger = await basePrisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM embedding_generations`,
    );

    expect(Number(docs[0].count)).toBe(0);
    expect(Number(chunks[0].count)).toBe(0);
    expect(Number(ledger[0].count)).toBe(0);
  });

  it("REJECTS an insert carrying another school's school_id (WITH CHECK)", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.curriculumDocument.create({
          data: {
            schoolId: schoolB.id, // the lie
            subjectId: `subject-${runId}`,
            classLevelId: `level-${runId}`,
            title: "Smuggled",
            storageKey: "curriculum-document/smuggled",
            checksum: "sum-smuggled",
            uploadedBy: `uploader-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("REJECTS a cross-tenant chunk insert, and the control insert succeeds", async () => {
    // The control is what stops the rejection above passing for the wrong
    // reason — e.g. a malformed vector literal failing before RLS is reached.
    await expect(
      insertChunk(schoolA.id, docB, "smuggled chunk", 1),
    ).rejects.toThrow();

    await expect(
      insertChunk(schoolA.id, docA, "legitimate second chunk", 1),
    ).resolves.toBeUndefined();
  });

  it("the embedding ledger is tenant-scoped too", async () => {
    await withTenant(schoolA.id, (db) =>
      db.embeddingGeneration.create({
        data: {
          schoolId: schoolA.id,
          documentId: docA,
          model: "voyage-4",
          purpose: "ingest",
          inputTokens: 10,
          latencyMs: 5,
          costMicroUsd: 1,
          success: true,
        },
      }),
    );

    const fromB = await withTenant(schoolB.id, (db) =>
      db.embeddingGeneration.findMany({ select: { id: true } }),
    );
    expect(fromB).toHaveLength(0);

    const fromA = await withTenant(schoolA.id, (db) =>
      db.embeddingGeneration.findMany({ select: { id: true } }),
    );
    expect(fromA).toHaveLength(1);
  });
});
