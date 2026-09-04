import { randomUUID } from "node:crypto";

import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import { chunkDocument } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  type ApproveCurriculumDocumentResponse,
  type CurriculumDocumentDetailResponse,
  type CurriculumDocumentDto,
  type CurriculumDocumentListResponse,
  type CurriculumUploadAcceptedResponse,
  type ListCurriculumDocumentsQuery,
  type PasteCurriculumDocumentInput,
  type UpdateCurriculumChunkInput,
  type UploadCurriculumDocumentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import {
  assertUserActiveAndHasOneOf,
  getActiveUserRoleKeys,
} from "../../common/auth/role-check";
import { EmbeddingService } from "../../common/embeddings/embedding.service";
import {
  CURRICULUM_JOB_EMBED,
  CURRICULUM_QUEUE,
  type TenantJobData,
} from "../../common/queue";
import { StorageService, pathFor as storagePathFor } from "../../common/storage";
import {
  CURRICULUM_CAP_ERROR_CODES,
  CURRICULUM_INGEST_ATTEMPTS,
  CURRICULUM_MAX_CHUNKS_PER_DOCUMENT,
  CURRICULUM_MAX_CHUNKS_PER_SCHOOL,
  CURRICULUM_MAX_DOCUMENTS_PER_SCHOOL,
} from "./curriculum.constants";
import {
  parsePastedText,
  parseUploadedDocument,
  type ParsedDocument,
} from "./parsing/document-parser";

const AUDIT = {
  upload: "curriculum.upload",
  delete: "curriculum.delete",
  // CP5 — the human-confirmation gate. Audited like every other approval gate
  // in this system (report comments, student import), because "a teacher
  // confirmed this" is exactly the kind of claim that must be evidenced.
  approve: "curriculum.approve",
} as const;

/**
 * The tenant-scoped Prisma client `withTenant` hands its callback. Named here
 * because the review helpers take it as a parameter — they run INSIDE an
 * existing transaction rather than opening their own, so that a heading edit
 * and its counter increment cannot half-apply.
 */
type TenantDb = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface IngestJobData extends TenantJobData {
  documentId: string;
}

/** CP5 — dispatched on approval, never on upload. */
export type EmbedJobData = IngestJobData;

// ---------------------------------------------------------------------------
// CurriculumService — the request-path half of ingestion.
//
// The division of labour with the worker is the important design decision here,
// and it follows D5 directly: "enforced at upload time where the user can see
// the refusal — not after they have waited for a job to fail."
//
//   IN THE REQUEST: parse, chunk, check every cap, persist the source file and
//   a PENDING row. All of this is fast, deterministic, and — crucially — able
//   to REFUSE. A file with no text layer, a document that busts a cap, a
//   duplicate re-upload: the teacher finds out while still looking at the form.
//
//   ON THE QUEUE: embedding, and only embedding. It is the slow part, the
//   part that costs money, and the only part subject to a vendor rate limit.
//
// The cost of that split is that the worker re-parses and re-chunks the source
// rather than receiving chunks on the job payload. That is deliberate and
// mirrors the CSV importer's commit handler, which re-streams source.csv for
// the same reason: a job payload is not a durable store, chunk text would
// bloat Redis, and re-deriving makes a retry after a crash correct by
// construction rather than by remembering to checkpoint.
// ---------------------------------------------------------------------------
@Injectable()
export class CurriculumService {
  private readonly logger = new Logger(CurriculumService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly embeddings: EmbeddingService,
    @InjectQueue(CURRICULUM_QUEUE) private readonly queue: Queue,
  ) {}

  async uploadFile(
    authCtx: AuthContext,
    input: UploadCurriculumDocumentInput,
    file: { buffer: Buffer; originalname: string; size: number; mimetype: string },
  ): Promise<CurriculumUploadAcceptedResponse> {
    const parsed = await parseUploadedDocument(file.buffer, file.mimetype ?? null);
    return this.ingest(authCtx, input, parsed, file.buffer, file.mimetype || "application/pdf", {
      fileName: file.originalname,
      fileSize: file.size,
    });
  }

  async uploadPastedText(
    authCtx: AuthContext,
    input: PasteCurriculumDocumentInput,
  ): Promise<CurriculumUploadAcceptedResponse> {
    const parsed = parsePastedText(input.content);
    const buffer = Buffer.from(parsed.text, "utf8");
    return this.ingest(authCtx, input, parsed, buffer, "text/plain; charset=utf-8", {
      fileName: null,
      fileSize: buffer.length,
    });
  }

  private async ingest(
    authCtx: AuthContext,
    input: UploadCurriculumDocumentInput,
    parsed: ParsedDocument,
    sourceBytes: Buffer,
    contentType: string,
    meta: { fileName: string | null; fileSize: number },
  ): Promise<CurriculumUploadAcceptedResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin", "teacher"]);

    // Refuse BEFORE doing any work if the vendor is not configured. Without
    // this the document would be accepted, queued, and fail in a worker the
    // teacher cannot see — the exact shape of failure D5 rules out. The
    // fail-soft contract from CP1 is what makes this a clean check rather than
    // a crash at boot.
    if (!this.embeddings.isConfigured()) {
      throw new ValidationError(
        "CURRICULUM_NOT_CONFIGURED",
        "Curriculum features are not configured on this deployment.",
      );
    }

    // Chunk in the request so chunkCount — which the per-document and
    // per-school caps are both denominated in — is known before we accept.
    const chunks = chunkDocument(parsed.text);
    if (chunks.length === 0) {
      throw new ValidationError(
        "CURRICULUM_EMPTY_DOCUMENT",
        "No usable text could be read from this document.",
      );
    }
    if (chunks.length > CURRICULUM_MAX_CHUNKS_PER_DOCUMENT) {
      throw new ValidationError(
        CURRICULUM_CAP_ERROR_CODES.DOCUMENT_TOO_LARGE,
        `This document produces ${chunks.length} sections, over the ${CURRICULUM_MAX_CHUNKS_PER_DOCUMENT} limit for a single document. Split it by term or subject and upload the parts separately.`,
      );
    }

    const documentId = randomUUID();

    await this.assertCapacityAndNotDuplicate(authCtx.schoolId, parsed.checksum, chunks.length);

    // Storage put happens BEFORE the transaction, not inside it. A blob whose
    // row was rolled back is unreachable garbage; a row whose blob is missing
    // is a document that can never be ingested and will retry forever. Of the
    // two, the orphan blob is the cheaper failure, and it is cleaned below.
    await this.storage.put(
      authCtx.schoolId,
      { kind: "curriculum-document", documentId },
      sourceBytes,
      contentType,
    );

    try {
      await withTenant(authCtx.schoolId, async (db) => {
        await db.curriculumDocument.create({
          data: {
            id: documentId,
            schoolId: authCtx.schoolId,
            subjectId: input.subjectId,
            classLevelId: input.classLevelId,
            title: input.title,
            storageKey: storagePathFor(authCtx.schoolId, {
              kind: "curriculum-document",
              documentId,
            }),
            checksum: parsed.checksum,
            // CP5 / D28 — straight to the review gate, NOT to a queue.
            //
            // Parsing and chunking already happened above (the caps are
            // denominated in chunks, so the count has to be known before we
            // accept). Writing those chunks here as well costs one bounded
            // insert and removes an entire polling stage from the critical
            // path: the teacher lands on the review screen immediately rather
            // than watching a spinner for work that is already done.
            //
            // Only EMBEDDING is queued now, and only once a human has approved.
            status: "AWAITING_REVIEW",
            chunkCount: chunks.length,
            uploadedBy: authCtx.userId,
          },
        });

        // Draft chunks: no vectors yet. `embedding` is nullable since CP5, and
        // Prisma omits Unsupported columns entirely, so an ordinary createMany
        // inserts NULL there — no raw SQL needed on this path, unlike the
        // embed step which must write the vector itself.
        await db.curriculumChunk.createMany({
          data: chunks.map((chunk) => ({
            schoolId: authCtx.schoolId,
            documentId,
            ordinal: chunk.ordinal,
            heading: chunk.heading,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
          })),
        });

        await db.auditLog.create({
          data: {
            schoolId: authCtx.schoolId,
            userId: authCtx.userId,
            action: AUDIT.upload,
            entityType: "curriculum_document",
            entityId: documentId,
            // No document text, and no filename contents beyond the name
            // itself — a scheme of work is not PII, but the audit log is not
            // where content belongs regardless.
            metadata: {
              subjectId: input.subjectId,
              classLevelId: input.classLevelId,
              sourceKind: parsed.kind,
              pageCount: parsed.pageCount,
              chunkCount: chunks.length,
              fileName: meta.fileName,
              fileSize: meta.fileSize,
            },
          },
        });
      });
    } catch (err) {
      await this.storage
        .delete(authCtx.schoolId, { kind: "curriculum-document", documentId })
        .catch(() => undefined);
      throw err;
    }

    return { documentId, status: "AWAITING_REVIEW", chunkCount: chunks.length };
  }

  /**
   * Every cap check, in one tenant-scoped read.
   *
   * Deliberately NOT a transaction with the insert that follows: two teachers
   * uploading simultaneously could each see room for one more document and
   * both proceed, overshooting the cap by one. That race is acceptable here
   * and locking is not — these are spend guardrails with two orders of
   * magnitude of headroom, not correctness invariants like an invoice balance.
   * Serialising every upload behind a lock to prevent an off-by-one in a
   * 200-document limit would be the wrong trade.
   */
  private async assertCapacityAndNotDuplicate(
    schoolId: string,
    checksum: string,
    incomingChunks: number,
  ): Promise<void> {
    const { documents, chunks, duplicate } = await withTenant(schoolId, async (db) => {
      const [documents, agg, duplicate] = await Promise.all([
        db.curriculumDocument.count({ where: { schoolId } }),
        db.curriculumDocument.aggregate({
          where: { schoolId },
          _sum: { chunkCount: true },
        }),
        db.curriculumDocument.findFirst({
          where: { schoolId, checksum, status: { in: ["PENDING", "PROCESSING", "READY"] } },
          select: { id: true, title: true },
        }),
      ]);
      return { documents, chunks: agg._sum.chunkCount ?? 0, duplicate };
    });

    if (duplicate) {
      // A ConflictError, not a silent success: re-uploading the same file is
      // usually a teacher who is not sure the first one worked, and telling
      // them it is already there answers the question they actually have.
      throw new ConflictError(
        CURRICULUM_CAP_ERROR_CODES.DUPLICATE_DOCUMENT,
        `This document has already been uploaded as "${duplicate.title}".`,
      );
    }
    if (documents >= CURRICULUM_MAX_DOCUMENTS_PER_SCHOOL) {
      throw new ValidationError(
        CURRICULUM_CAP_ERROR_CODES.TOO_MANY_DOCUMENTS,
        `This school has reached its limit of ${CURRICULUM_MAX_DOCUMENTS_PER_SCHOOL} curriculum documents. Delete an old one to upload another.`,
      );
    }
    if (chunks + incomingChunks > CURRICULUM_MAX_CHUNKS_PER_SCHOOL) {
      throw new ValidationError(
        CURRICULUM_CAP_ERROR_CODES.CORPUS_FULL,
        `This school's curriculum library is full (${CURRICULUM_MAX_CHUNKS_PER_SCHOOL} sections). Delete an old document to upload another.`,
      );
    }
  }

  async list(
    authCtx: AuthContext,
    query: ListCurriculumDocumentsQuery,
  ): Promise<CurriculumDocumentListResponse> {
    return withTenant(authCtx.schoolId, async (db) => {
      const documents = await db.curriculumDocument.findMany({
        where: {
          schoolId: authCtx.schoolId,
          ...(query.subjectId ? { subjectId: query.subjectId } : {}),
          ...(query.classLevelId ? { classLevelId: query.classLevelId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      const agg = await db.curriculumDocument.aggregate({
        where: { schoolId: authCtx.schoolId },
        _sum: { chunkCount: true },
      });
      const total = await db.curriculumDocument.count({ where: { schoolId: authCtx.schoolId } });

      return {
        documents: documents.map(toDto),
        usage: {
          documents: total,
          maxDocuments: CURRICULUM_MAX_DOCUMENTS_PER_SCHOOL,
          chunks: agg._sum.chunkCount ?? 0,
          maxChunks: CURRICULUM_MAX_CHUNKS_PER_SCHOOL,
        },
      };
    });
  }

  async getOne(
    authCtx: AuthContext,
    documentId: string,
  ): Promise<CurriculumDocumentDetailResponse> {
    return withTenant(authCtx.schoolId, async (db) => {
      const document = await db.curriculumDocument.findFirst({
        where: { id: documentId, schoolId: authCtx.schoolId },
      });
      if (!document) {
        throw new NotFoundError("Curriculum document not found.");
      }
      const chunks = await db.curriculumChunk.findMany({
        where: { documentId, schoolId: authCtx.schoolId },
        orderBy: { ordinal: "asc" },
        select: { id: true, ordinal: true, heading: true, content: true, tokenCount: true },
      });
      return { document: toDto(document), chunks };
    });
  }

  // -------------------------------------------------------------------------
  // CP5 — the review gate.
  //
  // Authorisation across all three operations follows D33: the controller's
  // `@Permissions("curriculum.upload")` is the coarse gate, and `assertCanEdit`
  // below is the substantive one. Approving is not a distinct authority from
  // uploading — someone trusted to add curriculum is trusted to confirm it
  // parsed correctly — so this reuses the delete path's ownership rule rather
  // than inventing a permission and a role-grant backfill for no access-control
  // gain.
  // -------------------------------------------------------------------------

  /**
   * Shared precondition for every review operation.
   *
   * Returns the document, having established that (a) it exists in this tenant,
   * (b) the caller may act on it, and (c) it is still IN review. That last check
   * is the one that matters most: a READY document's chunks are embedded, and
   * editing a heading after embedding would leave the stored vector describing
   * a heading the chunk no longer has — precisely the drift D28 avoids by
   * gating before embedding rather than after.
   */
  private async assertCanEdit(
    db: TenantDb,
    authCtx: AuthContext,
    documentId: string,
    isPrivileged: boolean,
  ): Promise<{ id: string; title: string; status: string; uploadedBy: string }> {
    const document = await db.curriculumDocument.findFirst({
      where: { id: documentId, schoolId: authCtx.schoolId },
      select: { id: true, title: true, status: true, uploadedBy: true },
    });
    if (!document) {
      throw new NotFoundError("Curriculum document not found.");
    }
    if (!isPrivileged && document.uploadedBy !== authCtx.userId) {
      throw new ForbiddenError(
        "CURRICULUM_NOT_UPLOADER",
        "You can only review curriculum documents you uploaded yourself. Ask an admin to review this one.",
      );
    }
    if (document.status !== "AWAITING_REVIEW") {
      throw new ConflictError(
        "CURRICULUM_NOT_IN_REVIEW",
        document.status === "READY"
          ? "This document has already been approved. Delete and re-upload it to change its sections."
          : "This document is still being processed and cannot be edited yet.",
      );
    }
    return document;
  }

  private async rolePrivilege(authCtx: AuthContext): Promise<boolean> {
    const roleKeys = await getActiveUserRoleKeys(authCtx);
    const isPrivileged = roleKeys.includes("owner") || roleKeys.includes("admin");
    if (!isPrivileged && !roleKeys.includes("teacher")) {
      throw new ForbiddenError(
        "CURRICULUM_REVIEW_FORBIDDEN",
        "This action requires one of the following roles: owner, admin, teacher.",
      );
    }
    return isPrivileged;
  }

  /**
   * Correct one chunk's heading path.
   *
   * Applied immediately rather than batched into the approval call, so a
   * dropped connection halfway through a review loses nothing. It also means
   * `headingEditCount` counts real corrections as they happen — D31's
   * measurement of how often the chunker gets a real document wrong.
   *
   * The counter increments only when the value actually CHANGES. A teacher who
   * clicks into a field and out again has not corrected anything, and counting
   * that would inflate the one number this feature produces as evidence.
   */
  async updateChunk(
    authCtx: AuthContext,
    documentId: string,
    chunkId: string,
    input: UpdateCurriculumChunkInput,
  ): Promise<CurriculumDocumentDetailResponse> {
    const isPrivileged = await this.rolePrivilege(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanEdit(db, authCtx, documentId, isPrivileged);

      const chunk = await db.curriculumChunk.findFirst({
        where: { id: chunkId, documentId, schoolId: authCtx.schoolId },
        select: { id: true, heading: true },
      });
      if (!chunk) {
        throw new NotFoundError("Curriculum section not found.");
      }

      const next = input.heading;
      if (chunk.heading !== next) {
        await db.curriculumChunk.update({ where: { id: chunkId }, data: { heading: next } });
        await db.curriculumDocument.update({
          where: { id: documentId },
          data: { headingEditCount: { increment: 1 } },
        });
      }

      return this.detail(db, authCtx.schoolId, documentId);
    });
  }

  /**
   * Discard a chunk the parser should not have produced — front matter, a
   * contents page, the recommended-textbooks block. Real documents carry
   * material that is not curriculum, and dropping it is the honest fix.
   *
   * A hard delete, not a soft flag. The row has no vector yet and nothing
   * references it, so there is no history worth preserving; a `discarded`
   * column would only add a filter every future query must remember. The COUNT
   * is preserved on the document, which is the part D31 needs.
   *
   * Refuses to empty a document: a zero-section document cannot be approved
   * into anything useful, and failing here — while the teacher is looking at
   * the screen — beats accepting it and producing a READY document that grounds
   * nothing.
   */
  async discardChunk(
    authCtx: AuthContext,
    documentId: string,
    chunkId: string,
  ): Promise<CurriculumDocumentDetailResponse> {
    const isPrivileged = await this.rolePrivilege(authCtx);

    return withTenant(authCtx.schoolId, async (db) => {
      await this.assertCanEdit(db, authCtx, documentId, isPrivileged);

      const chunk = await db.curriculumChunk.findFirst({
        where: { id: chunkId, documentId, schoolId: authCtx.schoolId },
        select: { id: true },
      });
      if (!chunk) {
        throw new NotFoundError("Curriculum section not found.");
      }
      const remaining = await db.curriculumChunk.count({
        where: { documentId, schoolId: authCtx.schoolId },
      });
      if (remaining <= 1) {
        throw new ValidationError(
          "CURRICULUM_LAST_SECTION",
          "A document must keep at least one section. Delete the whole document instead.",
        );
      }

      await db.curriculumChunk.delete({ where: { id: chunkId } });
      await db.curriculumDocument.update({
        where: { id: documentId },
        data: { discardedChunkCount: { increment: 1 }, chunkCount: { decrement: 1 } },
      });

      return this.detail(db, authCtx.schoolId, documentId);
    });
  }

  /**
   * Approve the extracted structure and queue embedding.
   *
   * This is the gate CP5 exists for. Everything before it is reversible and
   * costs nothing; this is the point where the school's curriculum becomes
   * something lesson plans are grounded in, and a human is now on record as
   * having said the structure is right.
   *
   * The status write and the queue add are deliberately ordered: the row moves
   * to EMBEDDING inside the transaction, and the job is enqueued only after it
   * commits. A job that arrived before the commit would find the document still
   * AWAITING_REVIEW and skip it, leaving a document that never embeds.
   */
  async approve(
    authCtx: AuthContext,
    documentId: string,
    ipAddress: string,
  ): Promise<ApproveCurriculumDocumentResponse> {
    const isPrivileged = await this.rolePrivilege(authCtx);

    if (!this.embeddings.isConfigured()) {
      throw new ValidationError(
        "CURRICULUM_NOT_CONFIGURED",
        "Curriculum features are not configured on this deployment.",
      );
    }

    const result = await withTenant(authCtx.schoolId, async (db) => {
      const existing = await this.assertCanEdit(db, authCtx, documentId, isPrivileged);

      const chunkCount = await db.curriculumChunk.count({
        where: { documentId, schoolId: authCtx.schoolId },
      });
      if (chunkCount === 0) {
        throw new ValidationError(
          "CURRICULUM_EMPTY_DOCUMENT",
          "This document has no sections left to approve.",
        );
      }

      const document = await db.curriculumDocument.update({
        where: { id: documentId },
        data: {
          status: "EMBEDDING",
          chunkCount,
          reviewedBy: authCtx.userId,
          reviewedAt: new Date(),
          errorMessage: null,
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.approve,
          entityType: "curriculum_document",
          entityId: documentId,
          ipAddress,
          // The measurement (D31) travels WITH the approval, so "how often does
          // the chunker read a real document correctly" is answerable from the
          // audit log alone, without joining to a row that keeps changing.
          metadata: {
            title: existing.title,
            chunkCount,
            headingEditCount: document.headingEditCount,
            discardedChunkCount: document.discardedChunkCount,
          },
        },
      });

      return { document: toDto(document), chunkCount };
    });

    await this.queue.add(
      CURRICULUM_JOB_EMBED,
      { schoolId: authCtx.schoolId, userId: authCtx.userId, documentId } satisfies EmbedJobData,
      {
        attempts: CURRICULUM_INGEST_ATTEMPTS,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return result;
  }

  /** Shared read used by every review mutation, so each returns fresh state. */
  private async detail(
    db: TenantDb,
    schoolId: string,
    documentId: string,
  ): Promise<CurriculumDocumentDetailResponse> {
    const document = await db.curriculumDocument.findFirst({
      where: { id: documentId, schoolId },
    });
    if (!document) {
      throw new NotFoundError("Curriculum document not found.");
    }
    const chunks = await db.curriculumChunk.findMany({
      where: { documentId, schoolId },
      orderBy: { ordinal: "asc" },
      select: { id: true, ordinal: true, heading: true, content: true, tokenCount: true },
    });
    return { document: toDto(document), chunks };
  }

  /**
   * Delete a document and its chunks.
   *
   * OWNERSHIP-SCOPED (revised 2026-09-03). Owner and admin may delete any
   * document; a teacher may delete only one they uploaded themselves.
   *
   * The original rule was owner/admin only, on the reasoning that deleting
   * cascades chunks and so changes what other teachers' lesson plans are
   * grounded in. That reasoning was thinner than it looked: a curriculum
   * document is scoped to ONE (subject, classLevel), so the people affected are
   * essentially that subject's own teachers — and the rule made every corrected
   * re-upload need an admin, which is recurring friction on the feature's
   * primary user.
   *
   * What the protection actually needs to guard is a teacher deleting a
   * COLLEAGUE'S material. Scoping to `uploadedBy` guards exactly that and
   * nothing more.
   *
   * Note the layering: `@Permissions("curriculum.delete")` on the controller is
   * the coarse gate (teachers now hold it), and this is the substantive one.
   * That is the same division the rest of the codebase uses — the guard says
   * "this surface exists for you", the service says "this ROW is yours".
   */
  async remove(authCtx: AuthContext, documentId: string, ipAddress: string): Promise<void> {
    const roleKeys = await getActiveUserRoleKeys(authCtx);
    const isPrivileged = roleKeys.includes("owner") || roleKeys.includes("admin");
    if (!isPrivileged && !roleKeys.includes("teacher")) {
      throw new ForbiddenError(
        "CURRICULUM_DELETE_FORBIDDEN",
        "This action requires one of the following roles: owner, admin, teacher.",
      );
    }

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.curriculumDocument.findFirst({
        where: { id: documentId, schoolId: authCtx.schoolId },
        select: { id: true, title: true, chunkCount: true, uploadedBy: true },
      });
      if (!existing) {
        throw new NotFoundError("Curriculum document not found.");
      }
      if (!isPrivileged && existing.uploadedBy !== authCtx.userId) {
        // Deliberately a distinct code from the role failure above: this is a
        // teacher who may delete their OWN documents being told which one this
        // is, not someone without the feature at all.
        throw new ForbiddenError(
          "CURRICULUM_NOT_UPLOADER",
          "You can only delete curriculum documents you uploaded yourself. Ask an admin to remove this one.",
        );
      }
      // Chunks go with it via ON DELETE CASCADE on the composite FK.
      await db.curriculumDocument.delete({ where: { id: documentId } });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.delete,
          entityType: "curriculum_document",
          entityId: documentId,
          ipAddress,
          metadata: { title: existing.title, chunkCount: existing.chunkCount },
        },
      });
    });

    // After the row is gone, so a storage failure cannot leave a document row
    // pointing at a deleted object.
    await this.storage
      .delete(authCtx.schoolId, { kind: "curriculum-document", documentId })
      .catch((err: unknown) => {
        this.logger.warn(
          `curriculum: deleted document ${documentId} but its source object remains: ${
            err instanceof Error ? err.message : "unknown"
          }`,
        );
      });
  }
}

function toDto(row: {
  id: string;
  subjectId: string;
  classLevelId: string;
  title: string;
  status: string;
  errorMessage: string | null;
  chunkCount: number;
  uploadedBy: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  headingEditCount: number;
  discardedChunkCount: number;
  createdAt: Date;
  updatedAt: Date;
}): CurriculumDocumentDto {
  return {
    id: row.id,
    subjectId: row.subjectId,
    classLevelId: row.classLevelId,
    title: row.title,
    status: row.status as CurriculumDocumentDto["status"],
    errorMessage: row.errorMessage,
    chunkCount: row.chunkCount,
    uploadedBy: row.uploadedBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    headingEditCount: row.headingEditCount,
    discardedChunkCount: row.discardedChunkCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
