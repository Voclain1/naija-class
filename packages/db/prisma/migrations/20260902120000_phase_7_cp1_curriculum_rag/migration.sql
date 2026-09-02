-- Phase 7 / CP1 — Curriculum RAG storage.
--
-- See docs/modules/phase-7.md. v1 grounds the EXISTING lesson-plan generator in
-- a school's own scheme of work; the student tutor is a later slice.
--
-- Three tables:
--   curriculum_documents   the uploaded source, and its processing lifecycle
--   curriculum_chunks      chunked text + its embedding (pgvector)
--   embedding_generations  per-call cost/compliance ledger for the embedding
--                          vendor, deliberately NOT ai_generations (D3)
--
-- pgvector needs no work here: the extension was created in the very first
-- migration (20260514120000_init) and in infra/postgres/init/01-extensions.sql,
-- in anticipation of exactly this phase.
--
-- EMBEDDING DIMENSION — 1024. This is voyage-4's default output dimension,
-- confirmed 2026-09-02 against Voyage's model documentation, not inferred from
-- voyage-3.5 (phase-7.md D2). The number is fixed at DDL time and cannot be
-- changed by an ALTER, but note the asymmetry: because the voyage-4 family is
-- trained with Matryoshka representation learning, REDUCING this later (1024 ->
-- 512) is a truncation of vectors already held — no re-embedding and no vendor
-- round-trip. Only INCREASING it requires re-embedding the corpus.
--
-- This migration was written by hand rather than taken verbatim from
-- `prisma migrate diff`, for two reasons: Prisma cannot emit the HNSW index or
-- the RLS policies below, and the generated diff also picked up unrelated
-- pre-existing drift between the local database and the migration history
-- (audit_logs constraint/index, payments unique index, a fee_items index
-- rename) which does not belong to this change.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

CREATE TYPE "CurriculumDocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "curriculum_documents" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "class_level_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "CurriculumDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "curriculum_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "curriculum_chunks" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "embedding_generations" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "document_id" TEXT,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "cost_micro_usd" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_generations_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------

-- The retrieval scope: chunks are searched within one school's subject +
-- class level, never across the whole tenant.
CREATE INDEX "curriculum_documents_school_id_subject_id_class_level_id_idx"
  ON "curriculum_documents"("school_id", "subject_id", "class_level_id");
CREATE INDEX "curriculum_documents_school_id_status_idx"
  ON "curriculum_documents"("school_id", "status");

CREATE INDEX "curriculum_chunks_school_id_idx"
  ON "curriculum_chunks"("school_id");
CREATE INDEX "curriculum_chunks_document_id_ordinal_idx"
  ON "curriculum_chunks"("document_id", "ordinal");

CREATE INDEX "embedding_generations_school_id_created_at_idx"
  ON "embedding_generations"("school_id", "created_at");
CREATE INDEX "embedding_generations_school_id_document_id_idx"
  ON "embedding_generations"("school_id", "document_id");

-- COMPOSITE foreign key on (document_id, school_id), not document_id alone.
--
-- Found by apps/api/src/__tests__/curriculum-rls.spec.ts while writing this
-- migration: Postgres evaluates referential-integrity checks with RLS
-- BYPASSED, so a plain document_id FK happily allowed a chunk carrying
-- school A's school_id to reference a document belonging to school B.
--
-- That was never a READ leak — RLS still stopped A from selecting B's
-- document — but it let curriculum_chunks.school_id disagree with its
-- parent's, which is exactly the invariant the denormalised column exists to
-- make cheap to enforce. Referencing the pair makes the disagreement
-- impossible in the database rather than merely unlikely in the service.
--
-- The unique constraint below exists only to be the target of that composite
-- FK; `id` is already the primary key.
ALTER TABLE "curriculum_documents"
  ADD CONSTRAINT "curriculum_documents_id_school_id_key" UNIQUE ("id", "school_id");

ALTER TABLE "curriculum_chunks"
  ADD CONSTRAINT "curriculum_chunks_document_id_school_id_fkey"
  FOREIGN KEY ("document_id", "school_id")
  REFERENCES "curriculum_documents"("id", "school_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- The vector index. HNSW rather than IVFFlat: IVFFlat needs to be built
-- against a populated table to choose its lists parameter, and this table is
-- empty at migration time. HNSW has no such requirement and degrades far more
-- gracefully as a school's corpus grows from zero.
--
-- Cosine distance (vector_cosine_ops) — Voyage embeddings are normalised, so
-- cosine and inner product rank identically; cosine is the conventional choice
-- and the one Voyage's own documentation uses.
--
-- NOTE: this index does NOT include school_id, and cannot usefully — pgvector
-- indexes one vector column. Tenant isolation on the similarity search comes
-- from RLS plus an explicit school_id predicate in the query, NOT from this
-- index. See the RLS block below.
CREATE INDEX "curriculum_chunks_embedding_hnsw_idx"
  ON "curriculum_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------------------------------------------------
-- RLS — copied verbatim from packages/db/prisma/policies/phase-7.sql,
-- following the convention phase-0.sql established.
--
-- A cross-tenant leak in curriculum_chunks would put ANOTHER SCHOOL'S
-- curriculum inside a teacher's lesson plan. That is the concrete failure this
-- policy prevents, and it is why the similarity search must run inside
-- withTenant() with the GUC set, not merely filter in application code.
--
-- No SECURITY DEFINER function is needed for any of these three tables: there
-- is no pre-tenant access path — every read and write happens inside
-- withTenant() with a known schoolId. The SD inventory count stays at 22.
-- ---------------------------------------------------------------------

ALTER TABLE "curriculum_documents"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_documents"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "curriculum_chunks"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "curriculum_chunks"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "embedding_generations"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "embedding_generations"  FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON curriculum_documents
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON curriculum_chunks
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON embedding_generations
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
