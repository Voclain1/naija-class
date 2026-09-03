import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";

import { EmbeddingService } from "../../common/embeddings/embedding.service";

// ---------------------------------------------------------------------------
// CurriculumRetrievalService — Phase 7 / CP3.
//
// Embeds a query, runs a tenant-scoped similarity search, and returns the
// chunks that clear a distance floor. It is the only reader of
// `curriculum_chunks.embedding`.
//
// THREE THINGS THIS SERVICE WILL NOT DO, each for a stated reason:
//
//   1. It will not THROW at its caller. Retrieval is additive (D18): a lesson
//      plan must still generate when the vendor is down, the school has
//      uploaded nothing, or nothing is relevant. Every failure path returns an
//      empty result with a `reason`, never an exception.
//   2. It will not cross a tenant, a subject, or a class level (D16).
//   3. It will not return its nearest neighbour unconditionally (D17). Cosine
//      distance always has a winner; a floor is what stops a Mathematics-only
//      corpus confidently grounding an English lesson.
// ---------------------------------------------------------------------------

/**
 * Maximum cosine distance for a chunk to be used as grounding.
 *
 * MEASURED, not guessed — and the first guess was wrong. 0.55 was proposed;
 * against the real JSS3 English corpus (2026-09-03) genuine queries scored
 * 0.5524–0.6391 and other-subject queries 0.7456–0.8343, so 0.55 would have
 * rejected EVERY genuine match and grounding would have silently never fired.
 * 0.69 is the midpoint of that measured gap.
 *
 * Still provisional: ten queries against one document of one subject is thin
 * evidence for a delicate constant, and the gap is only 0.107 wide. CP4 tunes
 * it from real usage — which is why every retrieval logs its distances
 * (`groundedOn`), so that tuning starts from data rather than another guess.
 */
export const RETRIEVAL_MAX_DISTANCE = 0.69;

/** Chunks passed to the model. Five ~500-token chunks is real context without crowding out the format instructions. */
export const RETRIEVAL_TOP_K = 5;

export interface RetrievedChunk {
  readonly chunkId: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly heading: string | null;
  readonly content: string;
  /** Cosine distance. Lower is closer. Stored so CP4 can tune the floor. */
  readonly distance: number;
}

export type RetrievalReason =
  /** Chunks were found above the floor. */
  | "ok"
  /** The school has no READY document for this subject + class level. */
  | "no-documents"
  /** Documents exist, but nothing cleared RETRIEVAL_MAX_DISTANCE. */
  | "no-match"
  /** The embedding vendor is not configured on this deployment. */
  | "not-configured"
  /** The query embedding failed. Degraded, never fatal. */
  | "error";

export interface RetrievalResult {
  readonly chunks: RetrievedChunk[];
  readonly reason: RetrievalReason;
  /** Distance of the nearest chunk even when it was rejected — CP4 tuning data. */
  readonly nearestDistance: number | null;
}

const EMPTY = (reason: RetrievalReason, nearestDistance: number | null = null): RetrievalResult => ({
  chunks: [],
  reason,
  nearestDistance,
});

@Injectable()
export class CurriculumRetrievalService {
  private readonly logger = new Logger(CurriculumRetrievalService.name);

  constructor(private readonly embeddings: EmbeddingService) {}

  /**
   * Find curriculum chunks relevant to a topic, for one school's subject and
   * class level.
   *
   * `query` is the teacher's topic (plus any objectives they typed) — short,
   * so the embedding costs about $0.000003 and is deliberately NOT budget-
   * reserved (D5).
   */
  async retrieve(params: {
    schoolId: string;
    subjectId: string;
    classLevelId: string;
    query: string;
  }): Promise<RetrievalResult> {
    if (!this.embeddings.isConfigured()) return EMPTY("not-configured");
    if (params.query.trim().length === 0) return EMPTY("no-match");

    // Cheap pre-check: if the school has nothing READY for this subject and
    // class level, skip the vendor call entirely. This is the common case for
    // every school that has not uploaded anything, and paying for a query
    // embedding to search an empty set would be a per-generation cost for no
    // possible result.
    const hasDocuments = await withTenant(params.schoolId, (db) =>
      db.curriculumDocument.count({
        where: {
          schoolId: params.schoolId,
          subjectId: params.subjectId,
          classLevelId: params.classLevelId,
          status: "READY",
        },
      }),
    );
    if (hasDocuments === 0) return EMPTY("no-documents");

    let queryVector: number[];
    try {
      const out = await this.embeddings.embed({
        schoolId: params.schoolId,
        inputs: [params.query],
        inputType: "query",
      });
      const vector = out.embeddings[0];
      if (!vector) return EMPTY("error");
      queryVector = vector;
    } catch (err) {
      // DEGRADE, never throw. A teacher must not lose their lesson plan
      // because a second vendor had a bad minute (D18).
      this.logger.warn(
        `retrieval: query embedding failed for school ${params.schoolId}: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
      return EMPTY("error");
    }

    const rows = await this.search(params, queryVector);
    if (rows.length === 0) return EMPTY("no-match");

    const nearest = rows[0]!.distance;
    const kept = rows.filter((r) => r.distance <= RETRIEVAL_MAX_DISTANCE);
    if (kept.length === 0) {
      // The nearest chunk is recorded even though it was rejected: it is what
      // tells CP4 whether the floor is too tight, and it is the number that
      // would otherwise have to be guessed a second time.
      this.logger.log(
        `retrieval: no chunk within ${RETRIEVAL_MAX_DISTANCE} for school ${params.schoolId} (nearest ${nearest.toFixed(4)})`,
      );
      return EMPTY("no-match", nearest);
    }

    return { chunks: kept, reason: "ok", nearestDistance: nearest };
  }

  /**
   * The similarity query.
   *
   * RAW SQL because `embedding` is `Unsupported("vector(1024)")` and Prisma
   * Client cannot read it. CLAUDE.md's raw-SQL rule applies directly, and D8
   * requires BOTH guards:
   *
   *   * `withTenant` sets `app.current_school_id`, so RLS filters the rows;
   *   * the statement ALSO carries `school_id` in its WHERE clause.
   *
   * Belt and braces. A cross-tenant leak here puts another school's curriculum
   * inside a teacher's lesson plan — plausible-looking, silent, and unlikely to
   * be reported as a bug by either school.
   *
   * The subject and class-level filters are a CORRECTNESS boundary, not a
   * relevance tweak (D16). Without them an English query can retrieve a
   * lexically-close Basic Science chunk and the plan is grounded in the wrong
   * subject's scheme — a confident wrong answer, which this phase has settled
   * is worse than none.
   */
  private async search(
    params: { schoolId: string; subjectId: string; classLevelId: string },
    queryVector: number[],
  ): Promise<RetrievedChunk[]> {
    // Composed from numbers we received from the vendor, never from user text.
    const literal = `[${queryVector.join(",")}]`;

    return withTenant(params.schoolId, (db) =>
      db.$queryRawUnsafe<RetrievedChunk[]>(
        `
        SELECT c.id                        AS "chunkId",
               c.document_id               AS "documentId",
               d.title                     AS "documentTitle",
               c.heading                   AS "heading",
               c.content                   AS "content",
               (c.embedding <=> $1::vector) AS "distance"
          FROM curriculum_chunks c
          JOIN curriculum_documents d
            ON d.id = c.document_id
           AND d.school_id = c.school_id
         WHERE c.school_id = $2
           AND d.school_id = $2
           AND d.subject_id = $3
           AND d.class_level_id = $4
           AND d.status = 'READY'
         ORDER BY c.embedding <=> $1::vector
         LIMIT $5
        `,
        literal,
        params.schoolId,
        params.subjectId,
        params.classLevelId,
        RETRIEVAL_TOP_K,
      ),
    );
  }
}
