import { randomUUID } from "node:crypto";

import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";

import { chunkDocument } from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type CurriculumDocumentDetailResponse,
  type CurriculumDocumentDto,
  type CurriculumDocumentListResponse,
  type CurriculumUploadAcceptedResponse,
  type ListCurriculumDocumentsQuery,
  type PasteCurriculumDocumentInput,
  type UploadCurriculumDocumentInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { EmbeddingService } from "../../common/embeddings/embedding.service";
import {
  CURRICULUM_JOB_INGEST,
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
} as const;

export interface IngestJobData extends TenantJobData {
  documentId: string;
}

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
            status: "PENDING",
            chunkCount: 0,
            uploadedBy: authCtx.userId,
          },
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

    await this.queue.add(
      CURRICULUM_JOB_INGEST,
      { schoolId: authCtx.schoolId, userId: authCtx.userId, documentId } satisfies IngestJobData,
      {
        attempts: CURRICULUM_INGEST_ATTEMPTS,
        // BullMQ's own backoff is the OUTER one — it covers a worker dying
        // mid-document. Vendor rate limiting is handled INSIDE the job by
        // retry.ts, because a 429 on batch 12 of 40 should not restart the
        // document and re-spend on batches 1-11.
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    return { documentId, status: "PENDING", chunkCount: chunks.length };
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
        throw new NotFoundError("CURRICULUM_DOCUMENT_NOT_FOUND", "Document not found.");
      }
      const chunks = await db.curriculumChunk.findMany({
        where: { documentId, schoolId: authCtx.schoolId },
        orderBy: { ordinal: "asc" },
        select: { id: true, ordinal: true, heading: true, content: true, tokenCount: true },
      });
      return { document: toDto(document), chunks };
    });
  }

  async remove(authCtx: AuthContext, documentId: string, ipAddress: string): Promise<void> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    await withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.curriculumDocument.findFirst({
        where: { id: documentId, schoolId: authCtx.schoolId },
        select: { id: true, title: true, chunkCount: true },
      });
      if (!existing) {
        throw new NotFoundError("CURRICULUM_DOCUMENT_NOT_FOUND", "Document not found.");
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
