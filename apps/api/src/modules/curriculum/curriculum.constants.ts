// Phase 7 / CP2 — per-school ingestion caps (D5).
//
// D5 is explicit about where these belong: "enforced at upload time where the
// user can see the refusal — not after they have waited for a job to fail."
// That is the design constraint these numbers exist to serve, and it is why
// the check runs in the request path even though the embedding itself does
// not.
//
// A cap that only bites inside the worker would still protect the bill, but it
// would tell a teacher their document failed after the upload appeared to
// succeed — the worst of both, since they cannot tell a cap from a bug.

/**
 * Multer's byte ceiling on the upload itself. Enforced mid-stream, so an
 * oversized file is aborted rather than buffered — the same mechanism the CSV
 * importer uses.
 *
 * 10 MB against the importer's 5 MB: a scheme of work exported from Word with
 * embedded fonts and a school crest is routinely 2-4 MB, where a CSV of the
 * same school's entire student roll is measured in kilobytes.
 */
export const CURRICULUM_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/**
 * Documents one school may hold. A secondary school running a full curriculum
 * has roughly (subjects x class levels) schemes of work — on the order of
 * 12 x 6 = 72 — so 200 leaves generous headroom for revisions and for the
 * per-term splits some schools keep, while still bounding a runaway loop.
 */
export const CURRICULUM_MAX_DOCUMENTS_PER_SCHOOL = 200;

/**
 * Total chunks one school may hold across every document.
 *
 * This, not the document count, is the real spend control: cost and retrieval
 * latency both scale with chunks, and one 500-page upload can carry more
 * chunks than a hundred ordinary ones. At ~500 tokens per chunk this bounds a
 * school's whole corpus at roughly 25M tokens of embedding — well inside the
 * 200M free allowance even if every school on the platform filled it.
 */
export const CURRICULUM_MAX_CHUNKS_PER_SCHOOL = 50_000;

/**
 * Chunks a single document may produce. A document exceeding this is refused
 * whole rather than truncated: half a scheme of work, silently, is worse than
 * a clear refusal, because retrieval would return confident answers from a
 * corpus with holes in it.
 */
export const CURRICULUM_MAX_CHUNKS_PER_DOCUMENT = 5_000;

/**
 * How many attempts the ingestion job gets from BullMQ.
 *
 * This is the OUTER retry, distinct from the inner per-batch backoff in
 * retry.ts. The inner one absorbs a busy vendor within a single run; this one
 * covers a worker dying mid-document. Both exist because they fail
 * differently — inner retries keep partial progress in memory, an outer retry
 * starts the document again.
 */
export const CURRICULUM_INGEST_ATTEMPTS = 3;

export const CURRICULUM_CAP_ERROR_CODES = {
  TOO_MANY_DOCUMENTS: "CURRICULUM_TOO_MANY_DOCUMENTS",
  CORPUS_FULL: "CURRICULUM_CORPUS_FULL",
  DOCUMENT_TOO_LARGE: "CURRICULUM_DOCUMENT_TOO_LARGE",
  DUPLICATE_DOCUMENT: "CURRICULUM_DUPLICATE_DOCUMENT",
} as const;
