// Shared DTO shapes for the CSV-import lifecycle. Imported by the API
// service + controller (to type the responses) and by the eventual web
// wizard (to type the tanstack-query payloads). Keep the union and
// statuses in sync with packages/db/prisma/schema.prisma's
// ImportJobType / ImportJobStatus enums.

export const IMPORT_JOB_TYPES = ["STUDENTS", "GUARDIANS", "TEACHERS"] as const;
export type ImportJobType = (typeof IMPORT_JOB_TYPES)[number];

export const IMPORT_JOB_STATUSES = [
  "PENDING",
  "VALIDATING",
  "READY",
  "COMMITTING",
  "COMPLETED",
  "FAILED",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

// Response of POST /imports/students/upload. The admin gets the jobId
// plus the headers and the first ~5 rows so the mapping UI can render
// without a second fetch.
export interface ImportUploadResponse {
  jobId: string;
  status: Extract<ImportJobStatus, "PENDING">;
  type: ImportJobType;
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
}

// Response of POST /imports/:jobId/mapping. The job has been queued for
// validation; the admin will poll GET /imports/:jobId to learn the result.
export interface ImportMappingAcceptedResponse {
  jobId: string;
  status: Extract<ImportJobStatus, "VALIDATING">;
}

// Response of POST /imports/:jobId/commit. Symmetric to the mapping
// response: the commit worker is enqueued and the admin will poll
// GET /imports/:jobId for status === COMPLETED | FAILED.
export interface ImportCommitAcceptedResponse {
  jobId: string;
  status: Extract<ImportJobStatus, "COMMITTING">;
}

// Response of GET /imports/:jobId. Carries everything the wizard needs
// to render whichever step the job is in:
//   - PENDING/VALIDATING: just status + counts (still 0 in PENDING)
//   - READY: status + counts + previewSnapshot for the preview screen
//   - COMPLETED/FAILED: status + counts + failedReason if set
//
// `previewSnapshot` is populated by the validate worker in cp3; cp2's
// stub fills it with an empty good/bad pair so the field shape stays
// stable across the cp transition.
export interface ImportJobPreviewSnapshot {
  good: { rowNumber: number; parsedRow: Record<string, unknown> }[];
  bad: {
    rowNumber: number;
    csvRow: Record<string, string>;
    errors: { field: string; message: string }[];
  }[];
}

export interface ImportJobDto {
  jobId: string;
  type: ImportJobType;
  status: ImportJobStatus;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  committedRows: number;
  previewSnapshot: ImportJobPreviewSnapshot | null;
  // True when status === COMPLETED and the commit worker wrote an
  // error-report.csv to storage. The wizard uses this to decide whether
  // to render the "Download error report" link on the /done screen.
  // The storage path itself is server-side only — the download goes
  // through GET /imports/:jobId/error-report.csv, which writes an audit
  // row (NDPR — PII export) before serving bytes.
  hasErrorReport: boolean;
  failedReason: string | null;
  createdAt: string;
  completedAt: string | null;
}
