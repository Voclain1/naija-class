import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../../common/auth/auth-context";
import { CurriculumService } from "./curriculum.service";

// Phase 7 / CP5 — the review gate.
//
// Runs against a real Postgres, for the same reason the delete-authz spec does:
// the rules under test depend on real role grants, a real `uploaded_by` column,
// and — new here — a real NULLABLE vector column. A mocked Prisma would be
// asserting my own arrangement of the data rather than the behaviour.
//
// What is actually being defended:
//
//   1. A teacher cannot review a colleague's document (D33's substantive gate).
//   2. A document that has already been approved cannot have its sections
//      edited. This is the one that protects correctness rather than access:
//      chunks are embedded WITH their headings (D15), so editing a heading
//      after embedding would leave a stored vector describing a heading the
//      chunk no longer has.
//   3. Approving is not idempotent-by-accident — a second approval is refused
//      rather than silently re-queueing vendor work that has already been paid
//      for.
//   4. A document cannot be emptied and then approved into something that
//      grounds nothing.
//   5. The edit counters (D31) count real corrections only. They are the one
//      piece of evidence this feature produces about chunker quality, and a
//      counter that increments on a no-op edit would quietly inflate it.

const runId = Math.random().toString(36).slice(2, 8);

interface QueuedJob {
  name: string;
  data: unknown;
}

function makeService(queued: QueuedJob[]): CurriculumService {
  const storage = { delete: async () => undefined } as never;
  const embeddings = { isConfigured: () => true } as never;
  const queue = {
    add: async (name: string, data: unknown) => {
      queued.push({ name, data });
    },
  } as never;
  return new CurriculumService(storage, embeddings, queue);
}

describe("CurriculumService — the review gate (CP5)", () => {
  let schoolId: string;
  let ownerCtx: AuthContext;
  let teacherACtx: AuthContext;
  let teacherBCtx: AuthContext;
  let queued: QueuedJob[];
  let service: CurriculumService;

  async function createUserWithRole(roleKey: string, email: string): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email,
          firstName: "R",
          lastName: roleKey,
          passwordHash: "x",
          isActive: true,
        },
        select: { id: true },
      });
      const role = await db.role.findFirstOrThrow({ where: { key: roleKey, isSystem: true } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { sessionId: `sess-${user.id}`, userId: user.id, schoolId };
    });
  }

  /** A document sitting exactly where an upload now leaves it. */
  async function createAwaitingReview(
    uploadedBy: string,
    title: string,
    sections = 3,
  ): Promise<{ documentId: string; chunkIds: string[] }> {
    return withTenant(schoolId, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId,
          subjectId: `subject-${runId}`,
          classLevelId: `level-${runId}`,
          title,
          storageKey: `curriculum/${title}`,
          checksum: `sum-${title}-${Math.random()}`,
          uploadedBy,
          status: "AWAITING_REVIEW",
          chunkCount: sections,
        },
        select: { id: true },
      });
      const chunkIds: string[] = [];
      for (let i = 0; i < sections; i++) {
        const chunk = await db.curriculumChunk.create({
          data: {
            schoolId,
            documentId: doc.id,
            ordinal: i,
            heading: `First Term > WEEK ${i + 1}`,
            content: `Section ${i} content`,
            tokenCount: 10,
          },
          select: { id: true },
        });
        chunkIds.push(chunk.id);
      }
      return { documentId: doc.id, chunkIds };
    });
  }

  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: { name: "Review Gate", slug: `review-gate-${runId}` },
      select: { id: true },
    });
    schoolId = school.id;

    await withTenant(schoolId, async (db) => {
      for (const [key, permissions] of [
        ["owner", ["*"]],
        ["teacher", ["curriculum.read", "curriculum.upload", "curriculum.delete"]],
      ] as const) {
        await db.role.create({
          data: { schoolId, key, name: key, isSystem: true, permissions: [...permissions] },
        });
      }
    });

    ownerCtx = await createUserWithRole("owner", `owner-${runId}@example.test`);
    teacherACtx = await createUserWithRole("teacher", `rev-a-${runId}@example.test`);
    teacherBCtx = await createUserWithRole("teacher", `rev-b-${runId}@example.test`);
  });

  beforeEach(() => {
    queued = [];
    service = makeService(queued);
  });

  afterAll(async () => {
    await withTenant(schoolId, (db) => db.auditLog.deleteMany({ where: { schoolId } }));
    await withTenant(schoolId, (db) => db.curriculumChunk.deleteMany({ where: { schoolId } }));
    await withTenant(schoolId, (db) => db.curriculumDocument.deleteMany({ where: { schoolId } }));
    await basePrisma.school.delete({ where: { id: schoolId } });
    await basePrisma.$disconnect();
  });

  // ---- draft chunks exist, and have no vector ---------------------------

  it("a document awaiting review holds chunks with NO embedding", async () => {
    const { documentId } = await createAwaitingReview(teacherACtx.userId, "no-vectors-yet");

    // Raw SQL: Prisma cannot express IS NULL on an Unsupported column, which is
    // exactly why the embed handler uses raw SQL for the same question.
    const rows = await withTenant(schoolId, (db) =>
      db.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM curriculum_chunks
        WHERE document_id = ${documentId}::text AND embedding IS NULL
      `,
    );
    expect(Number(rows[0]!.n)).toBe(3);
  });

  // ---- authorisation ----------------------------------------------------

  it("a teacher cannot edit a heading on a colleague's document", async () => {
    const { documentId, chunkIds } = await createAwaitingReview(teacherACtx.userId, "a-owns-this");

    await expect(
      service.updateChunk(teacherBCtx, documentId, chunkIds[0]!, { heading: "mine now" }),
    ).rejects.toMatchObject({ code: "CURRICULUM_NOT_UPLOADER" });
  });

  it("a teacher cannot approve a colleague's document", async () => {
    const { documentId } = await createAwaitingReview(teacherACtx.userId, "a-approves-this");

    await expect(service.approve(teacherBCtx, documentId, "127.0.0.1")).rejects.toMatchObject({
      code: "CURRICULUM_NOT_UPLOADER",
    });
    expect(queued).toHaveLength(0);
  });

  it("an owner may review any document in the school", async () => {
    const { documentId, chunkIds } = await createAwaitingReview(teacherACtx.userId, "owner-can");

    const detail = await service.updateChunk(ownerCtx, documentId, chunkIds[0]!, {
      heading: "First Term > WEEK 1 > Corrected",
    });
    expect(detail.chunks[0]!.heading).toBe("First Term > WEEK 1 > Corrected");
  });

  // ---- the counters are evidence, so they must not lie ------------------

  it("the heading edit counter increments only on a REAL change", async () => {
    const { documentId, chunkIds } = await createAwaitingReview(teacherACtx.userId, "counters");

    // A no-op: same value the chunk already has.
    let detail = await service.updateChunk(teacherACtx, documentId, chunkIds[0]!, {
      heading: "First Term > WEEK 1",
    });
    expect(detail.document.headingEditCount).toBe(0);

    detail = await service.updateChunk(teacherACtx, documentId, chunkIds[0]!, {
      heading: "First Term > WEEK 1 > Parts of speech",
    });
    expect(detail.document.headingEditCount).toBe(1);

    detail = await service.discardChunk(teacherACtx, documentId, chunkIds[1]!);
    expect(detail.document.discardedChunkCount).toBe(1);
    expect(detail.document.chunkCount).toBe(2);
    expect(detail.chunks).toHaveLength(2);
  });

  it("refuses to discard the last remaining section", async () => {
    const { documentId, chunkIds } = await createAwaitingReview(teacherACtx.userId, "last-one", 1);

    await expect(
      service.discardChunk(teacherACtx, documentId, chunkIds[0]!),
    ).rejects.toMatchObject({ code: "CURRICULUM_LAST_SECTION" });
  });

  // ---- approval ---------------------------------------------------------

  it("approval records the reviewer, queues embedding, and moves to EMBEDDING", async () => {
    const { documentId } = await createAwaitingReview(teacherACtx.userId, "approve-me");

    const result = await service.approve(teacherACtx, documentId, "127.0.0.1");

    expect(result.document.status).toBe("EMBEDDING");
    expect(result.document.reviewedBy).toBe(teacherACtx.userId);
    expect(result.document.reviewedAt).not.toBeNull();
    expect(result.chunkCount).toBe(3);

    expect(queued).toHaveLength(1);
    expect(queued[0]!.name).toBe("embed");
    expect(queued[0]!.data).toMatchObject({ documentId, schoolId });

    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({
        where: { schoolId, entityId: documentId, action: "curriculum.approve" },
      }),
    );
    expect(audit).not.toBeNull();
  });

  it("a document cannot be approved twice", async () => {
    const { documentId } = await createAwaitingReview(teacherACtx.userId, "approve-once");

    await service.approve(teacherACtx, documentId, "127.0.0.1");
    await expect(service.approve(teacherACtx, documentId, "127.0.0.1")).rejects.toMatchObject({
      code: "CURRICULUM_NOT_IN_REVIEW",
    });
    // The important half: no second job, so no second vendor bill.
    expect(queued).toHaveLength(1);
  });

  it("sections cannot be edited once the document is READY", async () => {
    const { documentId, chunkIds } = await createAwaitingReview(teacherACtx.userId, "already-live");
    await withTenant(schoolId, (db) =>
      db.curriculumDocument.update({ where: { id: documentId }, data: { status: "READY" } }),
    );

    // This is the correctness guard, not an access one: the stored vector was
    // computed from the heading, so a later edit would silently desynchronise
    // the two.
    await expect(
      service.updateChunk(teacherACtx, documentId, chunkIds[0]!, { heading: "too late" }),
    ).rejects.toMatchObject({ code: "CURRICULUM_NOT_IN_REVIEW" });

    await expect(
      service.discardChunk(teacherACtx, documentId, chunkIds[0]!),
    ).rejects.toMatchObject({ code: "CURRICULUM_NOT_IN_REVIEW" });
  });
});
