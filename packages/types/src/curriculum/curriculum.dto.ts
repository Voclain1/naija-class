import { z } from "zod";

// Phase 7 / CP2 — curriculum document ingestion DTOs.
//
// Two upload shapes, deliberately, because D6 commits to exactly two input
// formats and the paste box is not a fallback bolted on afterwards — it is the
// escape hatch that keeps the slice shippable when a real school's file will
// not parse. Giving it a first-class request shape rather than a "no file?
// look for a text field" branch is what keeps that promise honest.

export const CURRICULUM_DOCUMENT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;

export type CurriculumDocumentStatusDto = (typeof CURRICULUM_DOCUMENT_STATUSES)[number];

/** Fields common to both upload shapes. Multipart sends these as form fields. */
const baseUploadFields = {
  subjectId: z.string().uuid(),
  classLevelId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
};

export const uploadCurriculumDocumentSchema = z.object(baseUploadFields);

export type UploadCurriculumDocumentInput = z.infer<typeof uploadCurriculumDocumentSchema>;

export const pasteCurriculumDocumentSchema = z.object({
  ...baseUploadFields,
  // The ceiling matches CURRICULUM_MAX_FILE_SIZE_BYTES in spirit rather than
  // exactly: a megabyte of pasted characters is already far past what anyone
  // pastes deliberately, and JSON bodies are parsed whole before validation
  // runs, so this is a guard on the parse, not a business rule.
  content: z.string().min(1).max(1_000_000),
});

export type PasteCurriculumDocumentInput = z.infer<typeof pasteCurriculumDocumentSchema>;

export interface CurriculumDocumentDto {
  id: string;
  subjectId: string;
  classLevelId: string;
  title: string;
  status: CurriculumDocumentStatusDto;
  /** Populated only when status is FAILED. Redacted; never raw document text. */
  errorMessage: string | null;
  chunkCount: number;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** 202 response to an upload — ingestion runs on a queue, not in the request. */
export interface CurriculumUploadAcceptedResponse {
  documentId: string;
  status: CurriculumDocumentStatusDto;
  /**
   * Chunks the parser produced, known synchronously because parsing and
   * chunking happen in the request while only EMBEDDING is deferred.
   *
   * That split is deliberate: a document that cannot be parsed, or that busts
   * a cap, should be refused while the teacher is still looking at the form —
   * D5's "enforced at upload time where the user can see the refusal". Only
   * the slow, rate-limited, vendor-dependent part goes to the queue.
   */
  chunkCount: number;
}

export interface CurriculumDocumentListResponse {
  documents: CurriculumDocumentDto[];
  /** Cap telemetry, so the UI can warn before a teacher hits a refusal. */
  usage: {
    documents: number;
    maxDocuments: number;
    chunks: number;
    maxChunks: number;
  };
}

export const listCurriculumDocumentsQuerySchema = z.object({
  subjectId: z.string().uuid().optional(),
  classLevelId: z.string().uuid().optional(),
  status: z.enum(CURRICULUM_DOCUMENT_STATUSES).optional(),
});

export type ListCurriculumDocumentsQuery = z.infer<typeof listCurriculumDocumentsQuerySchema>;

/** One chunk, for the document detail view. Content is truncated for display. */
export interface CurriculumChunkDto {
  id: string;
  ordinal: number;
  heading: string | null;
  content: string;
  tokenCount: number;
}

export interface CurriculumDocumentDetailResponse {
  document: CurriculumDocumentDto;
  chunks: CurriculumChunkDto[];
}
